import { pool } from "./db.js";
import { transitionTask } from "./taskEngine.js";
import type { Task } from "./types.js";

export const DEFAULT_STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_CRASH_RECOVERIES = 2;

export interface CrashRecoveryResult {
  recoveredCount: number;
  failedCount: number;
  taskIds: string[];
}

/**
 * Recovers orphaned tasks stuck in 'running' status (e.g. after a worker process crash or container restart).
 *
 * Rules:
 * - Tasks stuck in 'running' for more than 5 minutes are checked.
 * - Counts existing 'recovered_after_crash' diary events.
 * - If recovery count < 2: moves task back to 'queued' with event 'recovered_after_crash' and clears worker lock.
 * - If recovery count >= 2: marks task as 'failed' with error "Task failed: exceeded maximum crash recoveries (2)".
 */
export async function runCrashRecovery(
  stuckThresholdMs: number = DEFAULT_STUCK_THRESHOLD_MS
): Promise<CrashRecoveryResult> {
  const client = await pool.connect();
  const recoveredIds: string[] = [];
  let recoveredCount = 0;
  let failedCount = 0;

  try {
    // 1. Identify tasks stuck in 'running' beyond the threshold
    const stuckRes = await client.query<Task>(
      `
      SELECT id, status, updated_at
      FROM tasks
      WHERE status = 'running'
        AND updated_at < NOW() - ($1 * INTERVAL '1 millisecond')
      `,
      [stuckThresholdMs]
    );

    for (const task of stuckRes.rows) {
      // 2. Count prior crash recovery attempts
      const countRes = await client.query<{ count: string }>(
        `
        SELECT COUNT(*) as count
        FROM task_events
        WHERE task_id = $1 AND event_type = 'recovered_after_crash'
        `,
        [task.id]
      );

      const recoveryCount = parseInt(countRes.rows[0]?.count ?? "0", 10);

      if (recoveryCount < MAX_CRASH_RECOVERIES) {
        // Move back to 'queued' so an active worker can retry
        await transitionTask(
          {
            taskId: task.id,
            toStatus: "queued",
            eventType: "recovered_after_crash",
            payload: {
              recoveryAttempt: recoveryCount + 1,
              maxAllowed: MAX_CRASH_RECOVERIES,
            },
            lockedBy: null,
          },
          client
        );
        recoveredCount++;
        recoveredIds.push(task.id);
        console.log(
          `[CrashRecovery] Task ${task.id} moved back to 'queued' (attempt ${recoveryCount + 1}/${MAX_CRASH_RECOVERIES}).`
        );
      } else {
        // Exceeded maximum crash recoveries, permanently fail the task
        await transitionTask(
          {
            taskId: task.id,
            toStatus: "failed",
            error: `Task failed: exceeded maximum crash recoveries (${MAX_CRASH_RECOVERIES})`,
            eventType: "recovery_failed_max_retries",
            payload: { recoveryAttempts: recoveryCount },
            lockedBy: null,
          },
          client
        );
        failedCount++;
        console.warn(
          `[CrashRecovery] Task ${task.id} permanently marked 'failed' after ${recoveryCount} recovery attempts.`
        );
      }
    }

    return {
      recoveredCount,
      failedCount,
      taskIds: recoveredIds,
    };
  } finally {
    client.release();
  }
}
