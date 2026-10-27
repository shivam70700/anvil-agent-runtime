import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import { pool } from "../db.js";
import { indexRepository } from "./indexer.js";

async function main() {
  const targetPath = process.argv[2] || config.REPO_PATH || ".";
  console.log(`Starting code indexing for path: "${targetPath}"...`);

  const startTime = Date.now();
  try {
    const result = await indexRepository(targetPath);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✓ Indexing complete!`);
    console.log(`  Repo:   ${result.repo}`);
    console.log(`  Files:  ${result.filesIndexed}`);
    console.log(`  Chunks: ${result.chunksIndexed}`);
    console.log(`  Time:   ${elapsed}s\n`);
  } catch (err) {
    console.error("Indexing failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
