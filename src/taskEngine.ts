import type { PoolClient } from "pg";
import { pool } from "./db.js";
import {
  IllegalStateTransitionError,
  TaskNotFoundError,
  VALID_TRANSITIONS,
  type Task,
  type TaskEvent,
  type TaskStatus,
} from "./types.js";

export interface TransitionOptions {
  taskId: string;
  toStatus: TaskStatus;
  eventType?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  lockedBy?: string | null;
}

export interface TransitionResult {
  task: Task;
  event: TaskEvent;
}

/**
 * Transitions a task from its current status to a new status in ONE atomic transaction.
 *
 * Steps:
 * 1. Locks the row with SELECT ... FOR UPDATE so concurrent workers cannot modify it.
 * 2. Validates that the transition is legal according to VALID_TRANSITIONS.
 * 3. Updates the task row (status, timestamps, result/error/locked_by).
 * 4. Inserts a corresponding row into task_events (append-only diary).
 * 5. Commits the transaction or rolls back on any error.
 */
export async function transitionTask(
  options: TransitionOptions,
  existingClient?: PoolClient
): Promise<TransitionResult> {
  const client = existingClient ?? (await pool.connect());
  const isOuterTransaction = !!existingClient;

  try {
    if (!isOuterTransaction) {
      await client.query("BEGIN");
    }

    // 1. Lock the row
    const selectRes = await client.query<Task>(
      "SELECT * FROM tasks WHERE id = $1 FOR UPDATE",
      [options.taskId]
    );

    if (selectRes.rows.length === 0) {
      throw new TaskNotFoundError(options.taskId);
    }

    const currentTask = selectRes.rows[0]!;
    const fromStatus = currentTask.status;
    const toStatus = options.toStatus;

    // 2. Validate the move
    const allowed = VALID_TRANSITIONS[fromStatus];
    if (!allowed.includes(toStatus)) {
      throw new IllegalStateTransitionError(options.taskId, fromStatus, toStatus);
    }

    // Determine locked_by: if moving to completed/failed/waiting_for_human, clear lock unless explicitly specified
    let newLockedBy = options.lockedBy !== undefined ? options.lockedBy : currentTask.locked_by;
    if (
      options.lockedBy === undefined &&
      (toStatus === "completed" || toStatus === "failed" || toStatus === "waiting_for_human")
    ) {
      newLockedBy = null;
    }

    const newResult = options.result !== undefined ? options.result : currentTask.result;
    const newError = options.error !== undefined ? options.error : currentTask.error;

    // 3. Update the task row
    const updateRes = await client.query<Task>(
      `
      UPDATE tasks
      SET
        status = $2,
        result = $3,
        error = $4,
        locked_by = $5,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        options.taskId,
        toStatus,
        newResult ? JSON.stringify(newResult) : null,
        newError,
        newLockedBy,
      ]
    );

    const updatedTask = updateRes.rows[0]!;

    // 4. Insert into task_events (append-only diary)
    const eventType = options.eventType ?? "status_transition";
    const payload = options.payload ?? {};

    const eventRes = await client.query<TaskEvent>(
      `
      INSERT INTO task_events (task_id, from_status, to_status, event_type, payload, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
      `,
      [
        options.taskId,
        fromStatus,
        toStatus,
        eventType,
        JSON.stringify(payload),
      ]
    );

    const createdEvent = eventRes.rows[0]!;

    if (!isOuterTransaction) {
      await client.query("COMMIT");
    }

    return {
      task: updatedTask,
      event: createdEvent,
    };
  } catch (err) {
    if (!isOuterTransaction) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    if (!isOuterTransaction) {
      client.release();
    }
  }
}

/**
 * Claims the next available 'queued' task for a given worker.
 *
 * Query breakdown:
 * 1. SELECT * FROM tasks: Fetch the task columns.
 * 2. WHERE status = 'queued': Only consider tasks waiting to be processed.
 * 3. ORDER BY created_at ASC: First-in, first-out (FIFO) ordering.
 * 4. LIMIT 1: Only claim one task at a time per worker.
 * 5. FOR UPDATE: Lock the selected row so other transactions cannot modify it.
 * 6. SKIP LOCKED: If another worker is currently locking a queued row, don't wait—
 *    skip past it immediately and grab the next available unlocked queued task!
 */
export async function claimNextTask(
  workerId: string
): Promise<TransitionResult | null> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const queryText = `
      SELECT id
      FROM tasks
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const res = await client.query<{ id: string }>(queryText);

    if (res.rows.length === 0) {
      // No queued tasks available right now
      await client.query("COMMIT");
      return null;
    }

    const taskId = res.rows[0]!.id;

    // Transition the claimed task to 'running' within the same transaction and lock
    const result = await transitionTask(
      {
        taskId,
        toStatus: "running",
        eventType: "claimed",
        payload: { workerId },
        lockedBy: workerId,
      },
      client
    );

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface RecordEventOptions {
  taskId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  fromStatus?: TaskStatus | string | null;
  toStatus?: TaskStatus | string;
}

/**
 * Appends an audit event to the task_events table without changing the task status.
 * Used for logging LLM calls, tool executions, and step progress.
 */
export async function recordTaskEvent(
  options: RecordEventOptions,
  client?: PoolClient
): Promise<TaskEvent> {
  const runner = client ?? pool;
  const res = await runner.query<TaskEvent>(
    `
    INSERT INTO task_events (task_id, from_status, to_status, event_type, payload, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *
    `,
    [
      options.taskId,
      options.fromStatus ?? "running",
      options.toStatus ?? "running",
      options.eventType,
      JSON.stringify(options.payload ?? {}),
    ]
  );
  return res.rows[0]!;
}


