import { pool } from "../db.js";
import type { SearchResult } from "./types.js";

export interface SearchOptions {
  repo?: string | undefined;
  limit?: number | undefined;
}

/**
 * Searches code_chunks using PostgreSQL full-text search with plainto_tsquery.
 *
 * Matches against the generated 'tsv' column and orders results by ts_rank.
 */
export async function keywordSearch(
  queryText: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const limit = options.limit ?? 10;
  const repo = options.repo ?? null;

  // plainto_tsquery safely parses user query without syntax errors
  const sql = `
    SELECT
      id as "chunkId",
      repo,
      file_path as "filePath",
      start_line as "startLine",
      end_line as "endLine",
      content,
      ts_rank(tsv, plainto_tsquery('english', $1)) as score
    FROM code_chunks
    WHERE tsv @@ plainto_tsquery('english', $1)
      AND ($2::text IS NULL OR repo = $2)
    ORDER BY score DESC
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
  }>(sql, [queryText, repo, limit]);

  return res.rows.map((row) => ({
    chunkId: Number(row.chunkId),
    repo: row.repo,
    filePath: row.filePath,
    startLine: row.startLine,
    endLine: row.endLine,
    content: row.content,
    score: Number(row.score),
    mode: "keyword" as const,
  }));
}
