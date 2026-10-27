import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { pool } from "../db.js";
import { withRetry } from "../llm/retry.js";
import { EMBEDDING_DIMENSION } from "./types.js";

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * MockEmbedder generates deterministic 768-dimensional normalized vectors.
 *
 * It uses simple word hashing so texts with overlapping keywords have high
 * cosine similarity, while unrelated texts have low similarity.
 * 100% offline, reproducible, and zero-cost for testing.
 */
export class MockEmbedder implements Embedder {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.generateVector(text));
  }

  private generateVector(text: string): number[] {
    const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
    const words = text.toLowerCase().match(/\b\w+\b/g) || [text];

    for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      let hash = 0;
      for (let j = 0; j < word.length; j++) {
        hash = (hash << 5) - hash + word.charCodeAt(j);
        hash |= 0;
      }
      const index = Math.abs(hash) % EMBEDDING_DIMENSION;
      vector[index] = (vector[index] ?? 0) + 1.0;
    }

    // Normalize to unit length (L2 norm) so cosine distance calculation is accurate
    let sumSq = 0;
    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      const val = vector[i] ?? 0;
      sumSq += val * val;
    }
    const norm = Math.sqrt(sumSq) || 1.0;
    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      vector[i] = Number(((vector[i] ?? 0) / norm).toFixed(6));
    }

    return vector;
  }
}

/**
 * GeminiEmbedder uses Google's official text-embedding-004 model (768 dimensions)
 * with automatic exponential backoff retries on rate limits.
 */
export class GeminiEmbedder implements Embedder {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey?: string, model: string = "text-embedding-004") {
    const key = apiKey || config.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is required to initialize GeminiEmbedder. Set it in .env or switch to MockEmbedder."
      );
    }
    this.ai = new GoogleGenAI({ apiKey: key });
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (const text of texts) {
      const response = await withRetry(async () => {
        return await this.ai.models.embedContent({
          model: this.model,
          contents: text,
        });
      });

      const values =
        response.embeddings?.[0]?.values ?? (response as any).embedding?.values;
      if (!values || values.length === 0) {
        throw new Error("Gemini returned empty embedding values");
      }
      embeddings.push(values);
    }

    return embeddings;
  }
}

/**
 * Creates an Embedder according to the configured LLM_MODE or explicitly requested mode.
 */
export function createEmbedder(mode: "mock" | "gemini" = config.LLM_MODE): Embedder {
  if (mode === "gemini") {
    return new GeminiEmbedder();
  }
  return new MockEmbedder();
}

export interface EmbedMissingOptions {
  batchSize?: number | undefined;
  pauseMs?: number | undefined;
  repo?: string | undefined;
  onProgress?: ((processed: number, total: number) => void) | undefined;
}

/**
 * Queries code_chunks that currently have NULL embeddings, computes their
 * embeddings in batches with rate-limiting pauses, and persists them back to Postgres.
 */
export async function embedMissingChunks(
  embedder: Embedder,
  options: EmbedMissingOptions = {}
): Promise<number> {
  const batchSize = options.batchSize ?? 10;
  const pauseMs = options.pauseMs ?? 500;
  const repo = options.repo ?? null;

  // 1. Count missing
  const countRes = await pool.query<{ count: string }>(
    `
    SELECT COUNT(*) as count
    FROM code_chunks
    WHERE embedding IS NULL
      AND ($1::text IS NULL OR repo = $1)
    `,
    [repo]
  );

  const totalMissing = parseInt(countRes.rows[0]?.count ?? "0", 10);
  if (totalMissing === 0) {
    return 0;
  }

  let processed = 0;

  while (processed < totalMissing) {
    // 2. Fetch next batch of missing chunks
    const batchRes = await pool.query<{ id: string | number; content: string }>(
      `
      SELECT id, content
      FROM code_chunks
      WHERE embedding IS NULL
        AND ($1::text IS NULL OR repo = $1)
      ORDER BY id ASC
      LIMIT $2
      `,
      [repo, batchSize]
    );

    if (batchRes.rows.length === 0) {
      break;
    }

    const ids = batchRes.rows.map((r) => r.id);
    const contents = batchRes.rows.map((r) => r.content);

    // 3. Compute embeddings
    const vectors = await embedder.embed(contents);

    // 4. Update rows in Postgres
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const vector = vectors[i]!;
      const vectorSqlString = `[${vector.join(",")}]`;

      await pool.query(
        "UPDATE code_chunks SET embedding = $1::vector, updated_at = NOW() WHERE id = $2",
        [vectorSqlString, id]
      );
    }

    processed += ids.length;
    if (options.onProgress) {
      options.onProgress(processed, totalMissing);
    }

    // 5. Pause between batches to protect against rate limits (especially in real mode)
    if (processed < totalMissing && pauseMs > 0) {
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }

  return processed;
}
