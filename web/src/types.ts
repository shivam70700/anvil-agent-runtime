export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_for_human"
  | "completed"
  | "failed";

export interface Task {
  id: string;
  type: string;
  status: TaskStatus;
  input: Record<string, any>;
  result: Record<string, any> | null;
  error: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  id: number;
  task_id: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  event_type: string;
  payload: Record<string, any>;
  created_at: string;
}

export interface TaskDetailResponse {
  task: Task;
  events: TaskEvent[];
}
