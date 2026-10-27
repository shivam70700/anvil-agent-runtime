import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

// Neon and Render production cloud databases require SSL
const isCloudPostgres =
  config.DATABASE_URL.includes("neon.tech") ||
  config.DATABASE_URL.includes("sslmode=require") ||
  config.DATABASE_URL.includes(".render.com") ||
  config.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: isCloudPostgres ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/**
 * Executes a query with automatic retries for transient cloud connection dropouts
 * (such as Neon serverless cold-start compute suspension).
 */
export async function queryWithRetry<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[],
  retries = 3
): Promise<pg.QueryResult<T>> {
  let attempt = 0;
  while (true) {
    try {
      return await pool.query<T>(text, params);
    } catch (err: any) {
      attempt++;
      const isConnectionError =
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        err.code === "57P01" ||
        err.message?.includes("Connection terminated") ||
        err.message?.includes("timeout");

      if (attempt >= retries || !isConnectionError) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

export const query = (text: string, params?: unknown[]) => pool.query(text, params);
