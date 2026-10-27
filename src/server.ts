import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import { createPatch } from "diff";
import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { authMiddleware } from "./middleware/auth.js";
import { dailyTaskCapMiddleware, rateLimitMiddleware } from "./middleware/rateLimit.js";
import { transitionTask } from "./taskEngine.js";
import { countOccurrences } from "./tools/proposeFix.js";
import { resolveSafePath } from "./tools/security.js";
import {
  TaskNotFoundError,
  type Task,
  type TaskEvent,
} from "./types.js";

export const app = express();

// 1. CORS Configuration: restricted to FRONTEND_ORIGIN
app.use(
  cors({
    origin: config.FRONTEND_ORIGIN === "*" ? "*" : config.FRONTEND_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());

// 2. Global Rate Limiter per IP
app.use(rateLimitMiddleware);

// 3. Shared Passcode Authentication (bypasses /health and OPTIONS)
app.use(authMiddleware);

// Zod schema for creating a new task (with 500-character prompt limit)
const createTaskSchema = z.object({
  type: z.string().min(1, "Task type is required"),
  input: z
    .record(z.unknown())
    .default({})
    .refine((data) => {
      const q = (data as any).query ?? (data as any).question;
      if (typeof q === "string" && q.length > 500) {
        return false;
      }
      return true;
    }, "Task query/question exceeds the maximum allowed length of 500 characters"),
});

// GET /health - Checks service health and database connectivity (public endpoint)
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
      mode: config.LLM_MODE,
      demoMode: config.DEMO_MODE,
    });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      database: "disconnected",
      error: (err as Error).message,
    });
  }
});

// GET /tasks - Retrieves list of all recent tasks (ordered newest first)
app.get("/tasks", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(req.query["limit"] as string, 10) || 50, 100);
    const tasksRes = await pool.query<Task>(
      "SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    res.json(tasksRes.rows);
  } catch (err) {
    next(err);
  }
});

// POST /tasks - Creates a new task in 'queued' status (enforcing daily task cap)
app.post(
  "/tasks",
  dailyTaskCapMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = createTaskSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: "Validation error",
          details: parseResult.error.flatten(),
        });
        return;
      }

      const { type, input } = parseResult.data;
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // 1. Insert into tasks
        const insertTaskRes = await client.query<Task>(
          `
          INSERT INTO tasks (type, status, input)
          VALUES ($1, 'queued', $2)
          RETURNING *
          `,
          [type, JSON.stringify(input)]
        );

        const task = insertTaskRes.rows[0]!;

        // 2. Insert initial creation event into diary
        await client.query(
          `
          INSERT INTO task_events (task_id, from_status, to_status, event_type, payload)
          VALUES ($1, NULL, 'queued', 'created', $2)
          `,
          [task.id, JSON.stringify({ input })]
        );

        await client.query("COMMIT");
        res.status(201).json(task);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  }
);

// GET /tasks/:id - Retrieves a task along with its full event diary
app.get("/tasks/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;

    const taskRes = await pool.query<Task>(
      "SELECT * FROM tasks WHERE id = $1",
      [id]
    );

    if (taskRes.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const task = taskRes.rows[0]!;

    const eventsRes = await pool.query<TaskEvent>(
      "SELECT * FROM task_events WHERE task_id = $1 ORDER BY created_at ASC",
      [id]
    );

    res.json({
      task,
      events: eventsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /tasks/:id/approve - Approves a waiting_for_human task, creates diff patch, applies it, and marks completed
app.post("/tasks/:id/approve", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;

    const taskRes = await pool.query<Task>("SELECT * FROM tasks WHERE id = $1", [id]);
    if (taskRes.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const currentTask = taskRes.rows[0]!;
    if (currentTask.status !== "waiting_for_human") {
      res.status(400).json({
        error: `Cannot approve task in '${currentTask.status}' status. Task must be in 'waiting_for_human'.`,
      });
      return;
    }

    const proposal = (currentTask.result as any)?.proposal;
    if (!proposal || !proposal.filePath || !proposal.oldText) {
      res.status(400).json({
        error: "Task does not contain a valid fix proposal in result.proposal.",
      });
      return;
    }

    // 1. Transition to 'running'
    await transitionTask({
      taskId: id,
      toStatus: "running",
      eventType: "human_approved",
    });

    const safeFilePath = resolveSafePath(config.REPO_PATH, proposal.filePath);
    const originalContent = await fs.readFile(safeFilePath, "utf-8");

    // Verify oldText matches uniquely
    const occurrences = countOccurrences(originalContent, proposal.oldText);
    if (occurrences !== 1) {
      const errMessage = `File was modified since proposal was created (old_text matches ${occurrences} times).`;
      await transitionTask({
        taskId: id,
        toStatus: "failed",
        error: errMessage,
      });
      res.status(409).json({ error: errMessage });
      return;
    }

    // 2. Build diff patch using diff package
    const patchedContent = originalContent.replace(proposal.oldText, proposal.newText);
    const patchString = createPatch(
      proposal.filePath,
      originalContent,
      patchedContent,
      "original",
      "patched"
    );

    // 3. Save to ./patches/<id>.patch
    const patchesDir = path.resolve(process.cwd(), "patches");
    await fs.mkdir(patchesDir, { recursive: true });
    const patchFileName = `${id}.patch`;
    const patchFilePath = path.join(patchesDir, patchFileName);
    await fs.writeFile(patchFilePath, patchString, "utf-8");

    // 4. Apply the change to disk UNLESS in DEMO_MODE
    if (!config.DEMO_MODE) {
      await fs.writeFile(safeFilePath, patchedContent, "utf-8");
    }

    // 5. Transition to 'completed'
    const finalResult = await transitionTask({
      taskId: id,
      toStatus: "completed",
      result: {
        ...proposal,
        patchFile: `./patches/${patchFileName}`,
        patch: patchString,
        demoMode: config.DEMO_MODE,
        status: config.DEMO_MODE ? "demo_approved" : "applied",
      },
      eventType: "fix_applied",
      payload: {
        patchFile: `./patches/${patchFileName}`,
        demoMode: config.DEMO_MODE,
      },
    });

    res.json({
      status: "completed",
      patchFile: `./patches/${patchFileName}`,
      demoMode: config.DEMO_MODE,
      task: finalResult.task,
    });
  } catch (err) {
    next(err);
  }
});

// POST /tasks/:id/reject - Rejects a waiting_for_human task, marks failed, changes nothing
app.post("/tasks/:id/reject", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;

    const taskRes = await pool.query<Task>("SELECT * FROM tasks WHERE id = $1", [id]);
    if (taskRes.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const currentTask = taskRes.rows[0]!;
    if (currentTask.status !== "waiting_for_human") {
      res.status(400).json({
        error: `Cannot reject task in '${currentTask.status}' status. Task must be in 'waiting_for_human'.`,
      });
      return;
    }

    const reason = (req.body?.reason as string) || "rejected by human";

    // Transition directly to 'failed'
    const finalResult = await transitionTask({
      taskId: id,
      toStatus: "failed",
      error: reason,
      eventType: "human_rejected",
      payload: { reason },
    });

    res.json({
      status: "failed",
      reason,
      task: finalResult.task,
    });
  } catch (err) {
    next(err);
  }
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof TaskNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});
