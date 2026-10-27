export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LlmMessage {
  role: "user" | "model";
  text?: string | undefined;
  toolCalls?: ToolCall[] | undefined;
  toolResult?: {
    name: string;
    result: string;
  } | undefined;
}

export interface LlmResponse {
  text?: string | undefined;
  toolCalls?: ToolCall[] | undefined;
}

export interface LlmClient {
  generate(
    messages: LlmMessage[],
    tools?: ToolDefinition[]
  ): Promise<LlmResponse>;
}
