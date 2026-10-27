import { config } from "../config.js";
import { GeminiLlm } from "./gemini.js";
import { MockLlm } from "./mock.js";
import type { LlmClient } from "./types.js";

export * from "./types.js";
export * from "./mock.js";
export * from "./gemini.js";
export * from "./retry.js";

/**
 * Creates an LlmClient based on the LLM_MODE environment variable.
 * Default is 'mock' for safe, offline development and tests.
 */
export function createLlmClient(): LlmClient {
  if (config.LLM_MODE === "gemini") {
    return new GeminiLlm();
  }
  return new MockLlm();
}
