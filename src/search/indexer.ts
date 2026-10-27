import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../db.js";
import { chunkText } from "./chunker.js";
import { scanSourceFiles } from "./scanner.js";

export interface IndexResult {
  repo: string;
  filesIndexed: number;
  chunksIndexed: number;
}

/**
 * Indexes all valid source code files in targetDir into code_chunks.
 *
 * Idempotency:
 * For each file, removes any previous chunks for that (repo, file_path) and inserts
 * the newly generated chunk spans. Re-running creates zero duplicates.
 */
export async function indexRepository(
  targetDir: string,
  repoName?: string
): Promise<IndexResult> {
  const absoluteTarget = path.resolve(targetDir);
  const repo = repoName ?? path.basename(absoluteTarget);

  console.log(`[Indexer] Scanning repository '${repo}' at ${absoluteTarget}...`);
  const files = await scanSourceFiles(absoluteTarget);
  console.log(`[Indexer] Discovered ${files.length} indexable text files.`);

  let totalChunks = 0;
  const client = await pool.connect();

  try {
    for (const relPath of files) {
      const fullPath = path.join(absoluteTarget, relPath);
      let content = "";
      try {
        content = await fs.readFile(fullPath, "utf-8");
      } catch {
        continue;
      }

      const chunks = chunkText(content);
      if (chunks.length === 0) continue;

      await client.query("BEGIN");
      try {
        // Clean out any old chunks for this specific file in this repo
        await client.query(
          "DELETE FROM code_chunks WHERE repo = $1 AND file_path = $2",
          [repo, relPath]
        );

        // Insert new chunks
        for (const chunk of chunks) {
          await client.query(
            `
            INSERT INTO code_chunks (repo, file_path, start_line, end_line, content)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (repo, file_path, start_line, end_line)
            DO UPDATE SET
              content = EXCLUDED.content,
              updated_at = NOW()
            `,
            [repo, relPath, chunk.startLine, chunk.endLine, chunk.content]
          );
        }

        await client.query("COMMIT");
        totalChunks += chunks.length;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[Indexer] Failed to index ${relPath}:`, err);
        throw err;
      }
    }

    return {
      repo,
      filesIndexed: files.length,
      chunksIndexed: totalChunks,
    };
  } finally {
    client.release();
  }
}
