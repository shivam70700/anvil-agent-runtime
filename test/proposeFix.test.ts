import fs from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent/index.js";
import { MockLlm } from "../src/llm/mock.js";
import { app } from "../src/server.js";
import { countOccurrences, proposeFixTool } from "../src/tools/proposeFix.js";
import { pool } from "../src/db.js";
import { transitionTask } from "../src/taskEngine.js";
import { defaultToolRegistry } from "../src/tools/registry.js";

describe("Phase 4: propose_fix & Human Approval Engine", () => {
  const testDir = path.resolve(process.cwd(), "test_sandbox");
  const testFile = path.join(testDir, "calculator.ts");
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(
      testFile,
      `export function add(a: number, b: number): number {\n  return a - b; // BUG\n}\n\nexport function duplicate(): string {\n  return "duplicate";\n  return "duplicate";\n}\n`,
      "utf-8"
    );

    // Check if Postgres is reachable; if not, provide in-memory task stubbing for test execution
    let isDbOnline = false;
    try {
      await pool.query("SELECT 1");
      isDbOnline = true;
    } catch {
      isDbOnline = false;
    }

    if (!isDbOnline) {
      const memoryTasks = new Map<string, any>();
      const memoryEvents: any[] = [];

      const mockQuery = vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        const text = sql.trim().toUpperCase();

        if (text.startsWith("SELECT 1")) {
          return { rows: [{ "?column?": 1 }] };
        }

        if (text.startsWith("BEGIN") || text.startsWith("COMMIT") || text.startsWith("ROLLBACK")) {
          return { rows: [] };
        }

        if (text.startsWith("INSERT INTO TASKS")) {
          const type = params[0];
          const input = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
          const id = `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const task = {
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
          const event = {
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

        if (text.includes("FROM TASKS WHERE ID = $1")) {
          const id = params[0];
          const task = memoryTasks.get(id);
          return { rows: task ? [{ ...task }] : [] };
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

        if (text.includes("FROM TASK_EVENTS WHERE TASK_ID = $1")) {
          const id = params[0];
          const events = memoryEvents.filter((e) => e.task_id === id);
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

    // Spin up ephemeral Express server for HTTP tests
    server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    server?.close();
    await fs.rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("propose_fix Validation & Sandboxing", () => {
    it("correctly counts occurrences of a substring", () => {
      const sample = "hello world hello";
      expect(countOccurrences(sample, "hello")).toBe(2);
      expect(countOccurrences(sample, "world")).toBe(1);
      expect(countOccurrences(sample, "missing")).toBe(0);
    });

    it("rejects path traversal attempting to escape REPO_PATH", async () => {
      const result = await defaultToolRegistry.execute("propose_fix", {
        file_path: "../../escape.ts",
        old_text: "foo",
        new_text: "bar",
        explanation: "test escape",
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain("escapes repository root");
    });

    it("returns an informative error when old_text is not found", async () => {
      const relPath = path.relative(process.cwd(), testFile);
      const result = await proposeFixTool.run({
        file_path: relPath,
        old_text: "const nonExistent = 12345;",
        new_text: "const fixed = 12345;",
        explanation: "Fix missing code",
      });

      expect(result).toContain("old_text was not found");
      expect(result).toContain("Verify the exact content");
    });

    it("returns an informative error when old_text matches multiple times", async () => {
      const relPath = path.relative(process.cwd(), testFile);
      const result = await proposeFixTool.run({
        file_path: relPath,
        old_text: 'return "duplicate";',
        new_text: 'return "unique";',
        explanation: "Fix duplicate",
      });

      expect(result).toContain("appears 2 times");
      expect(result).toContain("expand old_text to include unique surrounding lines");
    });

    it("accepts valid proposal without modifying the file on disk (apply nothing)", async () => {
      const relPath = path.relative(process.cwd(), testFile);
      const beforeContent = await fs.readFile(testFile, "utf-8");

      const result = await proposeFixTool.run({
        file_path: relPath,
        old_text: "return a - b; // BUG",
        new_text: "return a + b; // FIXED",
        explanation: "Fix subtraction bug in add function",
      });

      expect(result).toContain("Proposal recorded successfully");
      expect(result).toContain("No files were modified on disk");

      // Verify file on disk is strictly unchanged
      const afterContent = await fs.readFile(testFile, "utf-8");
      expect(afterContent).toBe(beforeContent);
    });
  });

  describe("Agent Loop Pause on Fix Proposal", () => {
    it("halts agent loop in 'waiting_for_human' status when propose_fix succeeds", async () => {
      const mockLlm = new MockLlm();
      const relPath = path.relative(process.cwd(), testFile);

      mockLlm.enqueue({
        text: "I spotted the bug in calculator.ts. Let me propose a fix.",
        toolCalls: [
          {
            name: "propose_fix",
            args: {
              file_path: relPath,
              old_text: "return a - b; // BUG",
              new_text: "return a + b;",
              explanation: "Add function should use plus operator",
            },
          },
        ],
      });

      const loopResult = await runAgentLoop({
        question: "Fix the bug in add()",
        llm: mockLlm,
        tools: defaultToolRegistry,
      });

      expect(loopResult.status).toBe("waiting_for_human");
      expect(loopResult.steps).toBe(1);
      expect(loopResult.answer).toContain("Proposal recorded successfully");
    });
  });

  describe("HTTP Approval & Rejection Endpoints (/tasks/:id/approve & /tasks/:id/reject)", () => {
    it("rejects approval with 400 when task is not in waiting_for_human status", async () => {
      // 1. Create a queued task
      const postRes = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test", input: { query: "test" } }),
      });
      const task = (await postRes.json()) as any;
      expect(task.status).toBe("queued");

      // 2. Try to approve a queued task
      const approveRes = await fetch(`${baseUrl}/tasks/${task.id}/approve`, {
        method: "POST",
      });
      expect(approveRes.status).toBe(400);
      const body = (await approveRes.json()) as any;
      expect(body.error).toContain("Cannot approve task in 'queued' status");
    });

    it("rejects rejection with 400 when task is not in waiting_for_human status", async () => {
      const postRes = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test", input: { query: "test" } }),
      });
      const task = (await postRes.json()) as any;

      const rejectRes = await fetch(`${baseUrl}/tasks/${task.id}/reject`, {
        method: "POST",
      });
      expect(rejectRes.status).toBe(400);
      const body = (await rejectRes.json()) as any;
      expect(body.error).toContain("Cannot reject task in 'queued' status");
    });

    it("successfully approves fix, creates .patch file, applies diff, and marks completed", async () => {
      const relPath = path.relative(process.cwd(), testFile);

      // 1. Create task
      const createRes = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fix_task", input: { query: "fix add" } }),
      });
      const task = (await createRes.json()) as any;

      // Worker claims the task and starts running
      await transitionTask({ taskId: task.id, toStatus: "running" });

      // 2. Propose fix (moves task to waiting_for_human)
      await proposeFixTool.run(
        {
          file_path: relPath,
          old_text: "return a - b; // BUG",
          new_text: "return a + b; // RESOLVED",
          explanation: "Change minus to plus",
        },
        { taskId: task.id }
      );

      // Verify task is now waiting_for_human
      const getRes = await fetch(`${baseUrl}/tasks/${task.id}`);
      const waitingTask = (await getRes.json()) as any;
      expect(waitingTask.task.status).toBe("waiting_for_human");

      // 3. Approve the fix
      const approveRes = await fetch(`${baseUrl}/tasks/${task.id}/approve`, {
        method: "POST",
      });
      expect(approveRes.status).toBe(200);
      const approveBody = (await approveRes.json()) as any;

      expect(approveBody.status).toBe("completed");
      expect(approveBody.patchFile).toContain(`${task.id}.patch`);

      // 4. Verify patch file exists on disk
      const patchDiskPath = path.resolve(process.cwd(), approveBody.patchFile);
      const patchContent = await fs.readFile(patchDiskPath, "utf-8");
      expect(patchContent).toContain("-  return a - b; // BUG");
      expect(patchContent).toContain("+  return a + b; // RESOLVED");

      // 5. Verify the target file was updated on disk
      const updatedFileContent = await fs.readFile(testFile, "utf-8");
      expect(updatedFileContent).toContain("return a + b; // RESOLVED");
      expect(updatedFileContent).not.toContain("return a - b; // BUG");

      // Clean up patch file
      await fs.rm(patchDiskPath, { force: true });
    });

    it("successfully rejects fix, transitions to failed, and leaves files unmodified", async () => {
      const relPath = path.relative(process.cwd(), testFile);
      const beforeRejectContent = await fs.readFile(testFile, "utf-8");

      // 1. Create task
      const createRes = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fix_task", input: { query: "fix add" } }),
      });
      const task = (await createRes.json()) as any;

      // Worker claims the task and starts running
      await transitionTask({ taskId: task.id, toStatus: "running" });

      // 2. Propose fix
      await proposeFixTool.run(
        {
          file_path: relPath,
          old_text: "export function duplicate()",
          new_text: "export function uniqueName()",
          explanation: "Rename duplicate function",
        },
        { taskId: task.id }
      );

      // 3. Reject the fix
      const rejectRes = await fetch(`${baseUrl}/tasks/${task.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "rejected by human" }),
      });

      expect(rejectRes.status).toBe(200);
      const rejectBody = (await rejectRes.json()) as any;
      expect(rejectBody.status).toBe("failed");
      expect(rejectBody.reason).toBe("rejected by human");

      // 4. Verify file was NOT modified
      const afterRejectContent = await fs.readFile(testFile, "utf-8");
      expect(afterRejectContent).toBe(beforeRejectContent);
    });
  });
});
