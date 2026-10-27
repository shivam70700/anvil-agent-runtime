import { z } from "zod";
import type { ToolDefinition } from "../llm/types.js";

export interface ToolContext {
  taskId?: string | undefined;
}

export interface Tool<TInput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, any>;
  parameters: Record<string, unknown>; // JSON Schema passed to the LLM
  run(input: TInput, context?: ToolContext): Promise<string>;
}

export type { ToolDefinition };
