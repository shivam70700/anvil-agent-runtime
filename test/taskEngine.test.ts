import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import { claimNextTask, transitionTask } from "../src/taskEngine.js";
import {
  IllegalStateTransitionError,
  TaskNotFoundError,
} from "../src/types.js";
import { insertQueuedTask, resetDatabase } from "./helpers.js";

describe("Task Engine (Phase 1)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("Legal Transitions", () => {
    it("moves queued -> running", async () => {
      const task = await insertQueuedTask();

      const result = await transitionTask({
        taskId: task.id,
        toStatus: "running",
        lockedBy: "worker-1",
      });

      expect(result.task.status).toBe("running");
      expect(result.task.locked_by).toBe("worker-1");
      expect(result.event.from_status).toBe("queued");
      expect(result.event.to_status).toBe("running");
    });

    it("moves running -> waiting_for_human and clears lock", async () => {
      const task = await insertQueuedTask();
      await transitionTask({ taskId: task.id, toStatus: "running", lockedBy: "w1" });

      const result = await transitionTask({
        taskId: task.id,
        toStatus: "waiting_for_human",
      });

      expect(result.task.status).toBe("waiting_for_human");
      expect(result.task.locked_by).toBeNull();
      expect(result.event.from_status).toBe("running");
      expect(result.event.to_status).toBe("waiting_for_human");
    });

    it("moves waiting_for_human -> running", async () => {
      const task = await insertQueuedTask();
      await transitionTask({ taskId: task.id, toStatus: "running" });
      await transitionTask({ taskId: task.id, toStatus: "waiting_for_human" });

      const result = await transitionTask({
        taskId: task.id,
        toStatus: "running",
        lockedBy: "w2",
      });

      expect(result.task.status).toBe("running");
      expect(result.task.locked_by).toBe("w2");
    });

    it("moves running -> completed (terminal) with result", async () => {
      const task = await insertQueuedTask();
      await transitionTask({ taskId: task.id, toStatus: "running" });

      const finalResult = { answer: "42" };
      const result = await transitionTask({
        taskId: task.id,
        toStatus: "completed",
        result: finalResult,
      });

      expect(result.task.status).toBe("completed");
      expect(result.task.result).toEqual(finalResult);
      expect(result.task.locked_by).toBeNull();
    });

    it("moves running -> failed (terminal) with error message", async () => {
      const task = await insertQueuedTask();
      await transitionTask({ taskId: task.id, toStatus: "running" });

      const result = await transitionTask({
        taskId: task.id,
        toStatus: "failed",
        error: "Fatal execution error",
      });

      expect(result.task.status).toBe("failed");
      expect(result.task.error).toBe("Fatal execution error");
      expect(result.task.locked_by).toBeNull();
    });

    it("moves waiting_for_human -> failed with error message", async () => {
      const task = await insertQueuedTask();
      await transitionTask({ taskId: task.id, toStatus: "running" });
      await transitionTask({ taskId: task.id, toStatus: "waiting_for_human" });

      const result = await transitionTask({
        taskId: task.id,
        toStatus: "failed",
        error: "Human rejected approval",
      });

      expect(result.task.status).toBe("failed");
      expect(result.task.error).toBe("Human rejected approval");
    });
  });

  describe("Illegal Transitions", () => {
    it("throws when skipping running: queued -> completed", async () => {
      const task = await insertQueuedTask();

      await expect(
        transitionTask({ taskId: task.id, toStatus: "completed" })
      ).rejects.toThrow(IllegalStateTransitionError);
    });

    it("throws when trying to transition from terminal completed state", async () => {
      const task = await insertQueuedTask();
      await transitionTask({ taskId: task.id, toStatus: "running" });
      await transitionTask({ taskId: task.id, toStatus: "completed" });

      await expect(
        transitionTask({ taskId: task.id, toStatus: "running" })
      ).rejects.toThrow(IllegalStateTransitionError);
    });

    it("throws when trying to transition from terminal failed state", async () => {
      const task = await insertQueuedTask();
      await transitionTask({ taskId: task.id, toStatus: "running" });
      await transitionTask({ taskId: task.id, toStatus: "failed" });

      await expect(
        transitionTask({ taskId: task.id, toStatus: "running" })
      ).rejects.toThrow(IllegalStateTransitionError);
    });

    it("throws TaskNotFoundError for nonexistent task ID", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";

      await expect(
        transitionTask({ taskId: fakeId, toStatus: "running" })
      ).rejects.toThrow(TaskNotFoundError);
    });
  });

  describe("Concurrency Test: 10 Tasks, 3 Workers", () => {
    it("ensures each of the 10 tasks is claimed exactly once across 3 workers", async () => {
      // 1. Insert 10 queued tasks
      const createdTasks = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          insertQueuedTask("concurrency_job", { index: i })
        )
      );

      const createdIds = new Set(createdTasks.map((t) => t.id));
      expect(createdIds.size).toBe(10);

      // Track tasks claimed per worker
      const workerClaims: Record<string, string[]> = {
        "worker-alpha": [],
        "worker-beta": [],
        "worker-gamma": [],
      };

      // Define worker loop
      async function runWorker(workerId: string) {
        while (true) {
          const claim = await claimNextTask(workerId);
          if (!claim) {
            // No more queued tasks to claim
            break;
          }
          workerClaims[workerId]!.push(claim.task.id);
        }
      }

      // 2. Launch 3 workers concurrently
      await Promise.all([
        runWorker("worker-alpha"),
        runWorker("worker-beta"),
        runWorker("worker-gamma"),
      ]);

      // 3. Verify that all 10 tasks were claimed
      const allClaimedIds = [
        ...workerClaims["worker-alpha"]!,
        ...workerClaims["worker-beta"]!,
        ...workerClaims["worker-gamma"]!,
      ];

      expect(allClaimedIds.length).toBe(10);

      // Ensure NO duplicate claims occurred (every ID is unique)
      const uniqueClaimedIds = new Set(allClaimedIds);
      expect(uniqueClaimedIds.size).toBe(10);

      // Ensure every original task was claimed
      for (const id of createdIds) {
        expect(uniqueClaimedIds.has(id)).toBe(true);
      }

      // Verify database state: all 10 tasks should now be 'running'
      const dbTasks = await pool.query<{ status: string; locked_by: string }>(
        "SELECT status, locked_by FROM tasks"
      );
      expect(dbTasks.rows.length).toBe(10);
      for (const row of dbTasks.rows) {
        expect(row.status).toBe("running");
        expect(["worker-alpha", "worker-beta", "worker-gamma"]).toContain(
          row.locked_by
        );
      }

      // Verify diary events: each task should have a 'claimed' event
      const dbEvents = await pool.query<{ event_type: string }>(
        "SELECT event_type FROM task_events WHERE event_type = 'claimed'"
      );
      expect(dbEvents.rows.length).toBe(10);
    });
  });
});
