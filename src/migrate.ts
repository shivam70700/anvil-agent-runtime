import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Discover all .sql files in the migrations directory
    const migrationsDir = path.resolve(__dirname, "../migrations");
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    // 3. Fetch already executed migrations
    const res = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations"
    );
    const executed = new Set(res.rows.map((r) => r.name));

    // 4. Run any unapplied migrations inside transactions
    for (const file of sqlFiles) {
      if (executed.has(file)) {
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`✓ Applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`✗ Failed applying migration ${file}:`, err);
        throw err;
      }
    }

    console.log("All migrations are up to date.");
  } finally {
    client.release();
  }
}

// Allow direct CLI invocation: tsx src/migrate.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Migration runner failed:", err);
      await pool.end();
      process.exit(1);
    });
}
