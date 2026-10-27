import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { resetRateLimits } from "../src/middleware/rateLimit.js";
import { MAX_CRASH_RECOVERIES, runCrashRecovery } from "../src/recovery.js";
import { app } from "../src/server.js";
import { transitionTask } from "../src/taskEngine.js";
import type { Task, TaskEvent } from "../src/types.js";
import { ensureTestDb, resetDatabase } from "./helpers.js";

describe("Phase 5: Deploy Hardening, Auth, Limits & Crash Recovery", () => {
  let server: any;
  let baseUrl: string;
  const originalPasscode = config.AUTH_PASSCODE;
  const originalDailyCap = config.DAILY_TASK_CAP;

  beforeAll(async () => {
    await ensureTestDb();
    server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    server?.close();
    (config as any).AUTH_PASSCODE = originalPasscode;
    (config as any).DAILY_TASK_CAP = originalDailyCap;
  });

  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits();
    (config as any).AUTH_PASSCODE = undefined;
    (config as any).DAILY_TASK_CAP = originalDailyCap;
  });

  describe("Shared Passcode Authentication", () => {
    it("allows public access to /health without passcode even when AUTH_PASSCODE is set", async () => {
      (config as any).AUTH_PASSCODE = "super-secret-passcode";

      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("ok");
    });

    it("rejects protected endpoint with 401 when passcode is missing or invalid", async () => {
      (config as any).AUTH_PASSCODE = "super-secret-passcode";

      // 1. Missing header
      const resNoHeader = await fetch(`${baseUrl}/tasks`);
      expect(resNoHeader.status).toBe(401);
      const dataNoHeader = await resNoHeader.json();
      expect(dataNoHeader.error).toMatch(/Unauthorized/i);

      // 2. Wrong passcode
      const resWrong = await fetch(`${baseUrl}/tasks`, {
        headers: { "x-anvil-passcode": "wrong-code" },
      });
      expect(resWrong.status).toBe(401);
    });

    it("accepts request when valid x-anvil-passcode header is supplied", async () => {
      (config as any).AUTH_PASSCODE = "super-secret-passcode";

      const res = await fetch(`${baseUrl}/tasks`, {
        headers: { "x-anvil-passcode": "super-secret-passcode" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("500-Character Query Limit", () => {
    it("rejects task creation when query exceeds 500 characters", async () => {
      const longQuery = "a".repeat(501);
      const res = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "code_fix",
          input: { query: longQuery },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Validation error");
      expect(JSON.stringify(data.details)).toMatch(/500 characters/i);
    });

    it("accepts task creation when query is within 500 characters", async () => {
      const validQuery = "Fix the math bug in calculator.ts";
      const res = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "code_fix",
          input: { query: validQuery },
        }),
      });

      expect(res.status).toBe(201);
      const task = await res.json();
      expect(task.id).toBeDefined();
      expect(task.status).toBe("queued");
    });
  });

  describe("Daily Task Cap", () => {
    it("enforces daily task creation ceiling and returns 429 when cap exceeded", async () => {
      // Temporarily set cap to 2 for deterministic test
      (config as any).DAILY_TASK_CAP = 2;

      // Mock pool count query for daily cap
      const originalQuery = pool.query;
      const countSpy = vi.spyOn(pool, "query").mockImplementation(async (sql: any, params?: any) => {
        if (typeof sql === "string" && sql.includes("FROM tasks WHERE created_at >= CURRENT_DATE")) {
          return { rows: [{ count: "2" }] } as any;
        }
        return originalQuery.call(pool, sql, params);
      });

      const res = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "code_fix",
          input: { query: "Valid query" },
        }),
      });

      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toMatch(/Daily task cap reached/i);

      countSpy.mockRestore();
    });
  });

  describe("Crash Recovery Engine", () => {
    it("moves tasks stuck in 'running' over threshold back to 'queued' (up to MAX_CRASH_RECOVERIES)", async () => {
      const client = await pool.connect();
      try {
        const insertRes = await client.query<Task>(
          `
          INSERT INTO tasks (type, status, input)
          VALUES ('stuck_task', 'queued', '{"test":true}')
          RETURNING *
          `
        );
        const taskId = insertRes.rows[0]!.id;

        // Transition to running
        await transitionTask({ taskId, toStatus: "running", lockedBy: "crashed-worker" }, client);

        // Run recovery with threshold 0 so current running task is treated as stuck
        const result = await runCrashRecovery(0);
        expect(result.recoveredCount).toBe(1);
        expect(result.taskIds).toContain(taskId);

        // Check task status moved to 'queued' and lock cleared
        const updatedRes = await client.query<Task>("SELECT * FROM tasks WHERE id = $1", [taskId]);
        expect(updatedRes.rows[0]?.status).toBe("queued");
        expect(updatedRes.rows[0]?.locked_by).toBeNull();
      } finally {
        client.release();
      }
    });

    it("permanently marks task 'failed' if recovery attempts exceed MAX_CRASH_RECOVERIES (2)", async () => {
      const client = await pool.connect();
      try {
        const insertRes = await client.query<Task>(
          `
          INSERT INTO tasks (type, status, input)
          VALUES ('perpetual_crash_task', 'queued', '{"test":true}')
          RETURNING *
          `
        );
        const taskId = insertRes.rows[0]!.id;

        // Simulate 2 previous crash recovery events
        await client.query(
          `
          INSERT INTO task_events (task_id, from_status, to_status, event_type, payload)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [taskId, "running", "queued", "recovered_after_crash", {}]
        );
        await client.query(
          `
          INSERT INTO task_events (task_id, from_status, to_status, event_type, payload)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [taskId, "running", "queued", "recovered_after_crash", {}]
        );

        // Transition to running
        await transitionTask({ taskId, toStatus: "running", lockedBy: "crashed-worker" }, client);

        // Run recovery
        const result = await runCrashRecovery(0);
        expect(result.failedCount).toBe(1);

        // Verify task was permanently failed
        const updatedRes = await client.query<Task>("SELECT * FROM tasks WHERE id = $1", [taskId]);
        expect(updatedRes.rows[0]?.status).toBe("failed");
        expect(updatedRes.rows[0]?.error).toMatch(/exceeded maximum crash recoveries/i);
      } finally {
        client.release();
      }
    });
  });
});
