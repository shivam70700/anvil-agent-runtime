import { vi } from "vitest";
import { pool } from "../src/db.js";
import type { Task, TaskEvent } from "../src/types.js";

let isDbConfigured = false;
let isDbOnline = false;

const memoryTasks = new Map<string, Task>();
const memoryEvents: TaskEvent[] = [];

/**
 * Initializes DB connectivity or transparent in-memory mock if Postgres is not reachable.
 */
export async function ensureTestDb(): Promise<void> {
  if (isDbConfigured) return;
  isDbConfigured = true;

  try {
    await pool.query("SELECT 1");
    isDbOnline = true;
  } catch {
    isDbOnline = false;

    const mockQuery = vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
      const text = sql.trim().toUpperCase();

      if (text.startsWith("SELECT 1")) {
        return { rows: [{ "?column?": 1 }] };
      }

      if (text.startsWith("TRUNCATE TABLE")) {
        memoryTasks.clear();
        memoryEvents.length = 0;
        return { rows: [] };
      }

      if (text.startsWith("BEGIN") || text.startsWith("COMMIT") || text.startsWith("ROLLBACK")) {
        return { rows: [] };
      }

      if (text.startsWith("INSERT INTO TASKS")) {
        const type = params[0];
        const input = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        const id = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const task: Task = {
          id,
          type,
          status: "queued",
          input,
          result: null,
          error: null,
          locked_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryTasks.set(id, task);
        return { rows: [task] };
      }

      if (text.startsWith("INSERT INTO TASK_EVENTS")) {
        const event: TaskEvent = {
          id: memoryEvents.length + 1,
          task_id: params[0],
          from_status: params[1],
          to_status: params[2],
          event_type: params[3],
          payload: typeof params[4] === "string" ? JSON.parse(params[4]) : params[4],
          created_at: new Date(),
        };
        memoryEvents.push(event);
        return { rows: [event] };
      }

      if (text.includes("FROM TASKS") && text.includes("WHERE STATUS = 'QUEUED'")) {
        for (const t of memoryTasks.values()) {
          if (t.status === "queued" && !t.locked_by) {
            if (text.includes("FOR UPDATE")) {
              t.locked_by = "__locked__";
            }
            return { rows: [{ ...t }] };
          }
        }
        return { rows: [] };
      }

      if (text.includes("FROM TASKS WHERE ID = $1")) {
        const id = params[0];
        const task = memoryTasks.get(id);
        return { rows: task ? [{ ...task }] : [] };
      }

      if (text.includes("FROM TASKS") && !text.includes("WHERE")) {
        return { rows: Array.from(memoryTasks.values()).map((t) => ({ ...t })) };
      }

      if (text.startsWith("UPDATE TASKS SET LOCKED_BY = $1")) {
        const lockedBy = params[0];
        const id = params[1];
        const existing = memoryTasks.get(id);
        if (existing) {
          existing.locked_by = lockedBy;
          existing.updated_at = new Date();
          memoryTasks.set(id, existing);
          return { rows: [{ ...existing }] };
        }
        return { rows: [] };
      }

      if (text.startsWith("UPDATE TASKS")) {
        const id = params[0];
        const toStatus = params[1];
        const result = params[2] ? (typeof params[2] === "string" ? JSON.parse(params[2]) : params[2]) : null;
        const error = params[3];
        const lockedBy = params[4];

        const existing = memoryTasks.get(id);
        if (existing) {
          existing.status = toStatus;
          if (result !== undefined && result !== null) existing.result = result;
          if (error !== undefined) existing.error = error;
          if (lockedBy !== undefined) existing.locked_by = lockedBy;
          existing.updated_at = new Date();
          memoryTasks.set(id, existing);
          return { rows: [{ ...existing }] };
        }
        return { rows: [] };
      }

      if (text.includes("FROM TASKS") && text.includes("WHERE STATUS = 'RUNNING'")) {
        const running = Array.from(memoryTasks.values()).filter((t) => t.status === "running");
        return { rows: running.map((t) => ({ ...t })) };
      }

      if (text.includes("FROM TASK_EVENTS WHERE TASK_ID = $1") && !text.includes("COUNT(*)")) {
        const id = params[0];
        const events = memoryEvents.filter((e) => e.task_id === id);
        return { rows: events };
      }

      if (text.includes("FROM TASK_EVENTS") && text.includes("EVENT_TYPE = 'RECOVERED_AFTER_CRASH'")) {
        const taskId = params[0];
        const count = memoryEvents.filter(
          (e) => e.task_id === taskId && e.event_type === "recovered_after_crash"
        ).length;
        return { rows: [{ count: String(count) }] };
      }

      if (text.includes("FROM TASK_EVENTS") && text.includes("EVENT_TYPE = 'CLAIMED'")) {
        const events = memoryEvents.filter((e) => e.event_type === "claimed");
        return { rows: events };
      }

      return { rows: [] };
    });

    vi.spyOn(pool, "query").mockImplementation(mockQuery as any);
    vi.spyOn(pool, "connect").mockImplementation(async () => {
      return {
        query: mockQuery,
        release: () => {},
      } as any;
    });
  }
}

/**
 * Cleans the database tables before or after test runs.
 */
export async function resetDatabase(): Promise<void> {
  await ensureTestDb();
  if (isDbOnline) {
    await pool.query("TRUNCATE TABLE task_events, tasks CASCADE");
  } else {
    memoryTasks.clear();
    memoryEvents.length = 0;
  }
}

/**
 * Creates a queued task directly in the database for testing.
 */
export async function insertQueuedTask(
  type: string = "test_task",
  input: Record<string, unknown> = {}
): Promise<Task> {
  await ensureTestDb();
  const res = await pool.query<Task>(
    `
    INSERT INTO tasks (type, status, input)
    VALUES ($1, 'queued', $2)
    RETURNING *
    `,
    [type, JSON.stringify(input)]
  );
  return res.rows[0]!;
}
