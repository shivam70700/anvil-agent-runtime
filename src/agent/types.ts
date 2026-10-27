import type { LlmClient, LlmMessage } from "../llm/types.js";
import type { ToolRegistry } from "../tools/registry.js";

export type AgentEventType =
  | "llm_call"
  | "llm_response"
  | "tool_call"
  | "tool_result"
  | "step_limit_exceeded"
  | "agent_completed"
  | "agent_failed";

export interface AgentEvent {
  type: AgentEventType;
  step: number;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface AgentLoopOptions {
  question: string;
  taskId?: string | undefined;
  llm?: LlmClient | undefined;
  tools?: ToolRegistry | undefined;
  maxSteps?: number | undefined;
  onEvent?: ((event: AgentEvent) => Promise<void> | void) | undefined;
}

export interface AgentLoopResult {
  status: "completed" | "waiting_for_human" | "step_limit_exceeded" | "failed";
  answer: string;
  error?: string | undefined;
  steps: number;
  messages: LlmMessage[];
}
