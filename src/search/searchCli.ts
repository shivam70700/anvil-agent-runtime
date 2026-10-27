import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "../db.js";
import { createEmbedder } from "./embedder.js";
import { keywordSearch } from "./keywordSearch.js";
import { semanticSearch } from "./semanticSearch.js";
import { hybridSearch } from "./hybridSearch.js";
import type { SearchMode, SearchResult } from "./types.js";

function parseArgs(args: string[]) {
  let query = "";
  let mode: SearchMode = "hybrid";
  let limit = 5;
  let repo: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--mode" && args[i + 1]) {
      const m = args[i + 1]!.toLowerCase();
      if (m === "keyword" || m === "semantic" || m === "hybrid") {
        mode = m;
      }
      i++;
    } else if (arg === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1]!, 10) || 5;
      i++;
    } else if (arg === "--repo" && args[i + 1]) {
      repo = args[i + 1];
      i++;
    } else if (!arg.startsWith("--") && !query) {
      query = arg;
    }
  }

  return { query, mode, limit, repo };
}

async function main() {
  const { query, mode, limit, repo } = parseArgs(process.argv.slice(2));

  if (!query) {
    console.error('Usage: npm run search -- "<query>" [--mode keyword|semantic|hybrid] [--limit 5]');
    process.exit(1);
  }

  console.log(`\nSearching for: "${query}" (mode: ${mode})\n`);

  try {
    let results: SearchResult[] = [];
    const embedder = createEmbedder();

    if (mode === "keyword") {
      results = await keywordSearch(query, { limit, repo });
    } else if (mode === "semantic") {
      results = await semanticSearch(query, embedder, { limit, repo });
    } else {
      results = await hybridSearch(query, embedder, { limit, repo });
    }

    if (results.length === 0) {
      console.log("No matching code chunks found.");
    } else {
      results.forEach((res, index) => {
        console.log(`[#${index + 1}] ${res.filePath}:${res.startLine}-${res.endLine} (score: ${res.score})`);
        console.log("--------------------------------------------------");
        const preview = res.content
          .split("\n")
          .slice(0, 5)
          .map((l) => "  " + l)
          .join("\n");
        console.log(preview);
        if (res.content.split("\n").length > 5) {
          console.log("  ...");
        }
        console.log("--------------------------------------------------\n");
      });
    }
  } catch (err) {
    console.error("Search failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
