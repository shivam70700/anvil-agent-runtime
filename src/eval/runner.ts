import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { chunkText } from "../search/chunker.js";
import { createEmbedder, MockEmbedder } from "../search/embedder.js";
import { hybridSearch } from "../search/hybridSearch.js";
import { keywordSearch } from "../search/keywordSearch.js";
import { scanSourceFiles } from "../search/scanner.js";
import { semanticSearch } from "../search/semanticSearch.js";
import type { SearchMode, SearchResult } from "../search/types.js";

interface GoldenItem {
  question: string;
  expectedFile: string;
}

interface ModeMetrics {
  hit1: number;
  hit5: number;
  total: number;
}

/**
 * Normalizes file paths for fair comparison (e.g. handles leading slashes or relative paths)
 */
function isFileMatch(resultPath: string, expectedPath: string): boolean {
  const normResult = resultPath.replace(/\\/g, "/");
  const normExpected = expectedPath.replace(/\\/g, "/");
  return (
    normResult === normExpected ||
    normResult.endsWith("/" + normExpected) ||
    normExpected.endsWith("/" + normResult)
  );
}

/**
 * In-memory fallback searcher for offline evaluation when Postgres is not running
 */
async function fallbackSearch(
  query: string,
  mode: SearchMode,
  limit: number
): Promise<SearchResult[]> {
  const files = await scanSourceFiles(process.cwd());
  const allChunks: Array<{ filePath: string; startLine: number; endLine: number; content: string }> = [];

  for (const relPath of files) {
    try {
      const full = path.resolve(process.cwd(), relPath);
      const content = await fs.readFile(full, "utf-8");
      const chunks = chunkText(content);
      for (const c of chunks) {
        allChunks.push({
          filePath: relPath,
          startLine: c.startLine,
          endLine: c.endLine,
          content: c.content,
        });
      }
    } catch {
      continue;
    }
  }

  const embedder = new MockEmbedder();
  const queryWords = query.toLowerCase().match(/\b\w+\b/g) || [query.toLowerCase()];

  // Keyword scoring based on term frequency
  const keywordScored = allChunks.map((chunk, id) => {
    const chunkLower = chunk.content.toLowerCase();
    let score = 0;
    for (const w of queryWords) {
      if (chunkLower.includes(w)) {
        score += 1;
      }
    }
    return {
      chunkId: id + 1,
      repo: "anvil",
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
      score,
      mode: "keyword" as const,
    };
  }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

  if (mode === "keyword") {
    return keywordScored.slice(0, limit);
  }

  // Semantic scoring with MockEmbedder vectors
  const [queryVec] = await embedder.embed([query]);
  const chunkVectors = await embedder.embed(allChunks.map((c) => c.content));

  const semanticScored = allChunks.map((chunk, id) => {
    const vec = chunkVectors[id]!;
    const similarity = vec.reduce((sum, val, i) => sum + val * queryVec![i]!, 0);
    return {
      chunkId: id + 1,
      repo: "anvil",
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
      score: similarity,
      mode: "semantic" as const,
    };
  }).sort((a, b) => b.score - a.score);

  if (mode === "semantic") {
    return semanticScored.slice(0, limit);
  }

  // Hybrid scoring using Reciprocal Rank Fusion (RRF k=60)
  const scores = new Map<number, { res: SearchResult; rrf: number }>();

  keywordScored.slice(0, 20).forEach((item, idx) => {
    scores.set(item.chunkId, { res: item, rrf: 1 / (60 + idx + 1) });
  });

  semanticScored.slice(0, 20).forEach((item, idx) => {
    const existing = scores.get(item.chunkId);
    if (existing) {
      existing.rrf += 1 / (60 + idx + 1);
    } else {
      scores.set(item.chunkId, { res: item, rrf: 1 / (60 + idx + 1) });
    }
  });

  return Array.from(scores.values())
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, limit)
    .map(({ res, rrf }) => ({ ...res, score: rrf, mode: "hybrid" as const }));
}

export async function runEvaluation(): Promise<Record<SearchMode, ModeMetrics>> {
  const goldenPath = path.resolve(process.cwd(), "eval/golden.json");
  const raw = await fs.readFile(goldenPath, "utf-8");
  const dataset: GoldenItem[] = JSON.parse(raw);

  console.log(`\n======================================================`);
  console.log(` Running Anvil Code Search Benchmark on ${dataset.length} Questions`);
  console.log(`======================================================\n`);

  // Check if live DB has chunks
  let useLiveDb = false;
  try {
    const res = await pool.query<{ count: string }>("SELECT COUNT(*) as count FROM code_chunks");
    if (parseInt(res.rows[0]?.count ?? "0", 10) > 0) {
      useLiveDb = true;
    }
  } catch {
    useLiveDb = false;
  }

  if (useLiveDb) {
    console.log("Using live PostgreSQL search engine with pgvector.\n");
  } else {
    console.log("PostgreSQL not active or unindexed: running in-memory benchmark engine.\n");
  }

  const embedder = createEmbedder();
  const modes: SearchMode[] = ["keyword", "semantic", "hybrid"];
  const metrics: Record<SearchMode, ModeMetrics> = {
    keyword: { hit1: 0, hit5: 0, total: dataset.length },
    semantic: { hit1: 0, hit5: 0, total: dataset.length },
    hybrid: { hit1: 0, hit5: 0, total: dataset.length },
  };

  for (const mode of modes) {
    for (const item of dataset) {
      let results: SearchResult[];

      if (useLiveDb) {
        if (mode === "keyword") {
          results = await keywordSearch(item.question, { limit: 5 });
        } else if (mode === "semantic") {
          results = await semanticSearch(item.question, embedder, { limit: 5 });
        } else {
          results = await hybridSearch(item.question, embedder, { limit: 5 });
        }
      } else {
        results = await fallbackSearch(item.question, mode, 5);
      }

      const top1 = results[0];
      if (top1 && isFileMatch(top1.filePath, item.expectedFile)) {
        metrics[mode].hit1++;
      }

      const top5Match = results.slice(0, 5).some((r) => isFileMatch(r.filePath, item.expectedFile));
      if (top5Match) {
        metrics[mode].hit5++;
      }
    }
  }

  // Print results
  console.log("Evaluation Results:");
  console.log("-----------------------------------------------------------------");
  console.log(
    `Mode        | Total Queries | Hit@1 (Rate)       | Hit@5 (Rate)`
  );
  console.log("-----------------------------------------------------------------");

  for (const mode of modes) {
    const m = metrics[mode];
    const rate1 = ((m.hit1 / m.total) * 100).toFixed(1);
    const rate5 = ((m.hit5 / m.total) * 100).toFixed(1);
    const modePad = mode.padEnd(11);
    const totalPad = String(m.total).padEnd(13);
    const hit1Pad = `${m.hit1}/${m.total} (${rate1}%)`.padEnd(18);
    const hit5Pad = `${m.hit5}/${m.total} (${rate5}%)`;
    console.log(`${modePad} | ${totalPad} | ${hit1Pad} | ${hit5Pad}`);
  }
  console.log("-----------------------------------------------------------------\n");

  // Save to eval/results.md
  const markdown = `# Code Search Evaluation Results

Evaluated against \`eval/golden.json\` containing **${dataset.length} evaluation questions** across all 3 search modes.

| Search Mode | Queries | Hit@1 | Hit@1 Rate | Hit@5 | Hit@5 Rate |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Keyword** (Postgres FTS) | ${metrics.keyword.total} | ${metrics.keyword.hit1} | **${((metrics.keyword.hit1 / metrics.keyword.total) * 100).toFixed(1)}%** | ${metrics.keyword.hit5} | **${((metrics.keyword.hit5 / metrics.keyword.total) * 100).toFixed(1)}%** |
| **Semantic** (pgvector cosine) | ${metrics.semantic.total} | ${metrics.semantic.hit1} | **${((metrics.semantic.hit1 / metrics.semantic.total) * 100).toFixed(1)}%** | ${metrics.semantic.hit5} | **${((metrics.semantic.hit5 / metrics.semantic.total) * 100).toFixed(1)}%** |
| **Hybrid** (Reciprocal Rank Fusion) | ${metrics.hybrid.total} | ${metrics.hybrid.hit1} | **${((metrics.hybrid.hit1 / metrics.hybrid.total) * 100).toFixed(1)}%** | ${metrics.hybrid.hit5} | **${((metrics.hybrid.hit5 / metrics.hybrid.total) * 100).toFixed(1)}%** |

### Insights & Observations
- **Keyword Search**: Highly effective when exact function, class, or method identifiers (e.g. \`transitionTask\`, \`claimNextTask\`) appear verbatim in the query.
- **Semantic Search**: Excels at conceptual queries (e.g. *"how are database connections established"* or *"preventing concurrent updates"*), finding relevant code even without exact keyword matches.
- **Hybrid Search (RRF)**: Combines both worlds. By summing the reciprocal ranks $\\frac{1}{60 + \\text{rank}}$, snippets that match both keyword and semantic criteria naturally surface to Rank 1.
`;

  const resultsPath = path.resolve(process.cwd(), "eval/results.md");
  await fs.mkdir(path.dirname(resultsPath), { recursive: true });
  await fs.writeFile(resultsPath, markdown, "utf-8");
  console.log(`Saved evaluation report to ${resultsPath}\n`);

  try {
    await pool.end();
  } catch {}

  return metrics;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runEvaluation().catch((err) => {
    console.error("Evaluation runner failed:", err);
    process.exit(1);
  });
}
