import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  ToolDefinition,
} from "./types.js";

export interface MockCallRecord {
  messages: LlmMessage[];
  tools?: ToolDefinition[] | undefined;
}

/**
 * MockLlm returns pre-scripted responses in order.
 * Perfect for deterministic testing with zero network calls and zero cost.
 */
export class MockLlm implements LlmClient {
  private queue: LlmResponse[] = [];
  public calls: MockCallRecord[] = [];

  constructor(initialResponses: LlmResponse[] = []) {
    this.queue = [...initialResponses];
  }

  /**
   * Queue a scripted response for the next generate() call
   */
  enqueue(response: LlmResponse): void {
    this.queue.push(response);
  }

  /**
   * Queue multiple scripted responses
   */
  enqueueAll(responses: LlmResponse[]): void {
    this.queue.push(...responses);
  }

  /**
   * Clear recorded calls and remaining queued responses
   */
  reset(): void {
    this.queue = [];
    this.calls = [];
  }

  async generate(
    messages: LlmMessage[],
    tools?: ToolDefinition[]
  ): Promise<LlmResponse> {
    this.calls.push({ messages: [...messages], tools });

    const nextResponse = this.queue.shift();
    if (!nextResponse) {
      return { text: "Mock LLM default response: task complete." };
    }

    return nextResponse;
  }
}
