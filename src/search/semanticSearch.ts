import { pool } from "../db.js";
import type { Embedder } from "./embedder.js";
import type { SearchOptions } from "./keywordSearch.js";
import type { SearchResult } from "./types.js";

/**
 * Searches code_chunks using pgvector cosine distance (<=>).
 *
 * Lower distance means higher semantic similarity.
 * Score is normalized to (1 - cosineDistance) where 1.0 is identical.
 */
export async function semanticSearch(
  queryText: string,
  embedder: Embedder,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const limit = options.limit ?? 10;
  const repo = options.repo ?? null;

  // 1. Generate embedding for query
  const [queryVector] = await embedder.embed([queryText]);
  if (!queryVector || queryVector.length === 0) {
    return [];
  }

  const vectorSql = `[${queryVector.join(",")}]`;

  // 2. Query Postgres using cosine distance operator (<=>)
  const sql = `
    SELECT
      id as "chunkId",
      repo,
      file_path as "filePath",
      start_line as "startLine",
      end_line as "endLine",
      content,
      (1 - (embedding <=> $1::vector)) as score
    FROM code_chunks
    WHERE embedding IS NOT NULL
      AND ($2::text IS NULL OR repo = $2)
    ORDER BY embedding <=> $1::vector ASC
    LIMIT $3;
  `;

  const res = await pool.query<{
    chunkId: string | number;
    repo: string;
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    score: number;
  }>(sql, [vectorSql, repo, limit]);

  return res.rows.map((row) => ({
    chunkId: Number(row.chunkId),
    repo: row.repo,
    filePath: row.filePath,
    startLine: row.startLine,
    endLine: row.endLine,
    content: row.content,
    score: Number(row.score),
    mode: "semantic" as const,
  }));
}
