import { config } from "./config.js";
import { pool } from "./db.js";
import { runCrashRecovery } from "./recovery.js";
import { app } from "./server.js";
import { startWorker } from "./worker.js";

async function main(): Promise<void> {
  console.log("==========================================");
  console.log("      Starting Anvil (API + Worker)       ");
  console.log(`  Environment: ${process.env.NODE_ENV ?? "development"}`);
  console.log(`  Port:        ${config.PORT}`);
  console.log(`  LLM Mode:    ${config.LLM_MODE}`);
  console.log(`  Demo Mode:   ${config.DEMO_MODE}`);
  console.log(`  Repo Path:   ${config.REPO_PATH}`);
  console.log("==========================================");

  // 1. Initial health / connection check and immediate crash recovery pass
  try {
    await pool.query("SELECT 1");
    console.log("[Anvil Prod] Database connection verified.");
    const initialRecovery = await runCrashRecovery();
    if (initialRecovery.recoveredCount > 0 || initialRecovery.failedCount > 0) {
      console.log(
        `[Anvil Prod] Startup recovery: recovered ${initialRecovery.recoveredCount} tasks, failed ${initialRecovery.failedCount} stuck tasks.`
      );
    }
  } catch (err) {
    console.warn("[Anvil Prod] Database connection warning during startup:", err);
  }

  // 2. Start HTTP API
  const server = app.listen(config.PORT, () => {
    console.log(`[Anvil Prod] HTTP API listening on port ${config.PORT}`);
  });

  // 3. Start crash recovery cron interval (runs every 60 seconds)
  const recoveryInterval = setInterval(async () => {
    try {
      await runCrashRecovery();
    } catch (err) {
      console.error("[Anvil Prod] Crash recovery check failed:", err);
    }
  }, 60_000);

  // 4. Start background worker loop
  const abortController = new AbortController();
  const workerPromise = startWorker({
    handleSignals: false,
    signal: abortController.signal,
  });

  // 5. Handle graceful shutdown
  let isShuttingDown = false;
  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Anvil Prod] Received ${signal}. Starting unified graceful shutdown...`);

    clearInterval(recoveryInterval);

    // Stop accepting new HTTP requests
    server.close(() => {
      console.log("[Anvil Prod] HTTP server stopped.");
    });

    // Abort worker loop and wait for active task
    abortController.abort();
    try {
      await workerPromise;
      console.log("[Anvil Prod] Worker loop halted.");
    } catch (err) {
      console.error("[Anvil Prod] Worker shutdown error:", err);
    }

    // Close database pool
    try {
      await pool.end();
      console.log("[Anvil Prod] Database pool closed.");
    } catch (err) {
      console.error("[Anvil Prod] Error closing database pool:", err);
    }

    console.log("[Anvil Prod] Shutdown complete. Goodbye!");
    process.exit(0);
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[Anvil Prod] Fatal startup error:", err);
  process.exit(1);
});
