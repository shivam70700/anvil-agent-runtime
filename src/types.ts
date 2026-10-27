import { z } from "zod";

export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting_for_human",
  "completed",
  "failed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskStatusSchema = z.enum(TASK_STATUSES);

export const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["running"],
  running: ["waiting_for_human", "completed", "failed", "queued"],
  waiting_for_human: ["running", "failed"],
  completed: [],
  failed: [],
};

export interface Task {
  id: string;
  type: string;
  status: TaskStatus;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  locked_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TaskEvent {
  id: number;
  task_id: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class IllegalStateTransitionError extends Error {
  constructor(taskId: string, fromStatus: TaskStatus, toStatus: TaskStatus) {
    super(
      `Illegal transition for task ${taskId}: cannot move from '${fromStatus}' to '${toStatus}'`
    );
    this.name = "IllegalStateTransitionError";
  }
}
