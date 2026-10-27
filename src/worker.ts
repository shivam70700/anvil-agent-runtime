import { fileURLToPath } from "node:url";
import path from "node:path";
import { executeTaskWithAgent } from "./agent/index.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { claimNextTask } from "./taskEngine.js";

export interface WorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  handleSignals?: boolean;
  signal?: AbortSignal;
}

/**
 * Runs the autonomous background worker loop:
 * 1. Claims the next available 'queued' task using SELECT ... FOR UPDATE SKIP LOCKED.
 * 2. Runs the agent loop on the claimed task.
 * 3. Records all events and transitions the task to 'completed' or 'failed'.
 * 4. Sleeps for pollIntervalMs (default 2s) if the queue is empty.
 * 5. Handles SIGINT / SIGTERM for clean, safe shutdown.
 */
export async function startWorker(options: WorkerOptions = {}): Promise<void> {
  const workerId =
    options.workerId ??
    `worker-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
  const pollIntervalMs = options.pollIntervalMs ?? config.WORKER_POLL_INTERVAL_MS;
  const handleSignals = options.handleSignals ?? true;

  console.log(`[Worker ${workerId}] Started. Polling every ${pollIntervalMs}ms...`);
  console.log(`[Worker ${workerId}] LLM Mode: ${config.LLM_MODE}, Repo: ${config.REPO_PATH}`);

  let isRunning = true;
  let isProcessing = false;
  let sleepResolve: (() => void) | null = null;

  if (options.signal) {
    if (options.signal.aborted) {
      isRunning = false;
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          isRunning = false;
          if (sleepResolve) {
            sleepResolve();
          }
        },
        { once: true }
      );
    }
  }

  // Graceful shutdown handler
  async function shutdown(signal: string) {
    if (!isRunning) return;
    console.log(`\n[Worker ${workerId}] Received ${signal}. Initiating graceful shutdown...`);
    isRunning = false;

    // Wake up if sleeping in idle state
    if (sleepResolve) {
      sleepResolve();
    }

    if (isProcessing) {
      console.log(`[Worker ${workerId}] Waiting for current active task to finish...`);
    }

    // Wait briefly for current task to complete before tearing down connections
    while (isProcessing) {
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log(`[Worker ${workerId}] Cleaning up database connection pool...`);
    await pool.end();
    console.log(`[Worker ${workerId}] Goodbye!`);
    process.exit(0);
  }

  if (handleSignals) {
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }

  while (isRunning) {
    try {
      isProcessing = true;
      const claimResult = await claimNextTask(workerId);

      if (claimResult) {
        const { task } = claimResult;
        console.log(`[Worker ${workerId}] Claimed task ${task.id} (type: ${task.type})`);

        const result = await executeTaskWithAgent(task);

        if (result.status === "completed") {
          console.log(`[Worker ${workerId}] ✓ Task ${task.id} completed in ${result.steps} steps.`);
        } else {
          console.log(`[Worker ${workerId}] ✗ Task ${task.id} ${result.status}: ${result.error}`);
        }
      } else {
        // Queue is empty, sleep until next poll interval or until woken up
        isProcessing = false;
        await new Promise<void>((resolve) => {
          sleepResolve = resolve;
          setTimeout(resolve, pollIntervalMs);
        });
        sleepResolve = null;
      }
    } catch (err: any) {
      console.error(`[Worker ${workerId}] Error in worker loop:`, err);
      // Brief pause to avoid rapid error loops if database has issues
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      isProcessing = false;
    }
  }
}

// Allow direct CLI execution: npm run worker / tsx src/worker.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startWorker().catch((err) => {
    console.error("Fatal worker error:", err);
    process.exit(1);
  });
}
