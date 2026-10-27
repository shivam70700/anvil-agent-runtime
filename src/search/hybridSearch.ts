import type { Embedder } from "./embedder.js";
import { keywordSearch, type SearchOptions } from "./keywordSearch.js";
import { semanticSearch } from "./semanticSearch.js";
import type { SearchResult } from "./types.js";

/**
 * Standard smoothing constant for Reciprocal Rank Fusion (RRF).
 * Standardized in academic literature and search engines (Cormack et al., SIGIR 2009).
 */
export const RRF_K = 60;

/**
 * Executes Hybrid Search combining Keyword Search (PostgreSQL full-text)
 * and Semantic Search (pgvector cosine distance) using Reciprocal Rank Fusion (RRF).
 *
 * RRF Score formula:
 * score(d) = (1 / (k + rank_keyword)) + (1 / (k + rank_semantic))
 */
export async function hybridSearch(
  queryText: string,
  embedder: Embedder,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const limit = options.limit ?? 10;
  // Fetch up to 2x candidates from each search method to ensure robust fusion
  const candidateLimit = Math.max(limit * 2, 20);

  const [keywordResults, semanticResults] = await Promise.all([
    keywordSearch(queryText, { ...options, limit: candidateLimit }),
    semanticSearch(queryText, embedder, { ...options, limit: candidateLimit }),
  ]);

  const scores = new Map<number, { result: SearchResult; rrfScore: number }>();

  // 1. Accumulate RRF scores from Keyword Search
  for (let rank = 0; rank < keywordResults.length; rank++) {
    const res = keywordResults[rank]!;
    const rankPos = rank + 1; // 1-indexed rank
    const contribution = 1.0 / (RRF_K + rankPos);

    scores.set(res.chunkId, {
      result: res,
      rrfScore: contribution,
    });
  }

  // 2. Accumulate RRF scores from Semantic Search
  for (let rank = 0; rank < semanticResults.length; rank++) {
    const res = semanticResults[rank]!;
    const rankPos = rank + 1; // 1-indexed rank
    const contribution = 1.0 / (RRF_K + rankPos);

    const existing = scores.get(res.chunkId);
    if (existing) {
      existing.rrfScore += contribution;
    } else {
      scores.set(res.chunkId, {
        result: res,
        rrfScore: contribution,
      });
    }
  }

  // 3. Sort all chunks by fused RRF score descending
  const sorted = Array.from(scores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);

  return sorted.map(({ result, rrfScore }) => ({
    chunkId: result.chunkId,
    repo: result.repo,
    filePath: result.filePath,
    startLine: result.startLine,
    endLine: result.endLine,
    content: result.content,
    score: Number(rrfScore.toFixed(6)),
    mode: "hybrid" as const,
  }));
}
