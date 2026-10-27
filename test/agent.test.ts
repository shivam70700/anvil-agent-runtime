import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentLoop, type AgentEvent } from "../src/agent/index.js";
import { MockLlm } from "../src/llm/mock.js";
import { withRetry } from "../src/llm/retry.js";
import { resolveSafePath } from "../src/tools/security.js";
import { defaultToolRegistry } from "../src/tools/registry.js";

describe("Agent & Tool Engine (Phase 2)", () => {
  describe("Tool Security & Path Traversal Defense", () => {
    it("allows valid paths inside the repository", () => {
      const repoRoot = process.cwd();
      const safe = resolveSafePath(repoRoot, "package.json");
      expect(safe).toBe(path.join(repoRoot, "package.json"));
    });

    it("rejects path traversal attempting to escape via '../'", () => {
      const repoRoot = process.cwd();
      expect(() => resolveSafePath(repoRoot, "../escape.txt")).toThrow(
        "escapes repository root"
      );
    });

    it("rejects path traversal attempting to escape to root '/etc/passwd'", () => {
      const repoRoot = process.cwd();
      expect(() => resolveSafePath(repoRoot, "/etc/passwd")).toThrow(
        "escapes repository root"
      );
    });

    it("tool execution returns error message when path escapes", async () => {
      const result = await defaultToolRegistry.execute("read_file", {
        path: "../../secret.key",
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain("escapes repository root");
    });
  });

  describe("Agent Loop with MockLlm", () => {
    it("executes tool call then produces final answer (tool then answer)", async () => {
      const mockLlm = new MockLlm();

      // Step 1: LLM asks to list files
      mockLlm.enqueue({
        toolCalls: [
          {
            name: "list_files",
            args: { path: "." },
          },
        ],
      });

      // Step 2: LLM receives file list and produces final answer
      mockLlm.enqueue({
        text: "The repository contains package.json and src directory.",
      });

      const events: AgentEvent[] = [];
      const result = await runAgentLoop({
        question: "What files are in the repository?",
        llm: mockLlm,
        onEvent: (e) => {
          events.push(e);
        },
      });

      expect(result.status).toBe("completed");
      expect(result.steps).toBe(2);
      expect(result.answer).toBe(
        "The repository contains package.json and src directory."
      );

      // Verify conversation message progression
      expect(result.messages.length).toBe(4);
      expect(result.messages[0]?.role).toBe("user"); // Question
      expect(result.messages[1]?.role).toBe("model"); // Tool call
      expect(result.messages[2]?.role).toBe("user"); // Tool result
      expect(result.messages[2]?.toolResult?.name).toBe("list_files");
      expect(result.messages[3]?.role).toBe("model"); // Final answer

      // Verify full event trail
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toEqual([
        "llm_call",
        "llm_response",
        "tool_call",
        "tool_result",
        "llm_call",
        "llm_response",
        "agent_completed",
      ]);
    });

    it("handles bad arguments with self-correction feedback", async () => {
      const mockLlm = new MockLlm();

      // Step 1: Model calls read_file with missing required 'path' parameter
      mockLlm.enqueue({
        toolCalls: [
          {
            name: "read_file",
            args: {}, // Invalid: path is required
          },
        ],
      });

      // Step 2: Model sees error feedback, corrects argument
      mockLlm.enqueue({
        toolCalls: [
          {
            name: "read_file",
            args: { path: "package.json" },
          },
        ],
      });

      // Step 3: Model finishes
      mockLlm.enqueue({
        text: "Successfully read package.json.",
      });

      const result = await runAgentLoop({
        question: "Read package.json",
        llm: mockLlm,
      });

      expect(result.status).toBe("completed");
      expect(result.steps).toBe(3);

      // Verify error feedback was delivered in step 1
      const step1Result = result.messages[2]?.toolResult;
      expect(step1Result?.name).toBe("read_file");
      expect(step1Result?.result).toContain("Invalid arguments for tool 'read_file'");

      // Verify corrected output was delivered in step 2
      const step2Result = result.messages[4]?.toolResult;
      expect(step2Result?.name).toBe("read_file");
      expect(step2Result?.result).toContain('"name": "anvil"');
    });

    it("enforces 8-step safety circuit breaker limit", async () => {
      const mockLlm = new MockLlm();

      // Enqueue 10 continuous tool calls (exceeding the 8-step maximum)
      for (let i = 0; i < 10; i++) {
        mockLlm.enqueue({
          text: `Thinking turn ${i}...`,
          toolCalls: [
            {
              name: "list_files",
              args: { path: "." },
            },
          ],
        });
      }

      const events: AgentEvent[] = [];
      const result = await runAgentLoop({
        question: "Loop forever please",
        llm: mockLlm,
        maxSteps: 8,
        onEvent: (e) => {
          events.push(e);
        },
      });

      expect(result.status).toBe("step_limit_exceeded");
      expect(result.steps).toBe(8);
      expect(result.error).toContain("exceeded maximum step limit of 8 steps");
      expect(events.some((e) => e.type === "step_limit_exceeded")).toBe(true);
    });
  });

  describe("LLM Retry & Exponential Backoff", () => {
    it("retries on 429 rate limit and succeeds on subsequent attempt", async () => {
      let attempts = 0;
      const retryLog: number[] = [];

      const mockOperation = async () => {
        attempts++;
        if (attempts < 3) {
          const err: any = new Error("Rate limit exceeded");
          err.status = 429;
          throw err;
        }
        return "SUCCESS";
      };

      const result = await withRetry(mockOperation, {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffFactor: 2,
        sleepFn: async (ms) => {
          retryLog.push(ms);
        },
      });

      expect(result).toBe("SUCCESS");
      expect(attempts).toBe(3);
      // Wait progression: 10ms, then 20ms
      expect(retryLog).toEqual([10, 20]);
    });

    it("throws if transient error persists beyond maxRetries", async () => {
      let attempts = 0;

      const mockOperation = async () => {
        attempts++;
        const err: any = new Error("503 Service Unavailable");
        err.status = 503;
        throw err;
      };

      await expect(
        withRetry(mockOperation, {
          maxRetries: 3,
          initialDelayMs: 5,
          sleepFn: async () => {},
        })
      ).rejects.toThrow("503 Service Unavailable");

      expect(attempts).toBe(4); // Initial try + 3 retries
    });

    it("fails immediately without retrying for non-retryable errors (e.g. 400 Bad Request)", async () => {
      let attempts = 0;

      const mockOperation = async () => {
        attempts++;
        const err: any = new Error("Bad Request: invalid prompt");
        err.status = 400;
        throw err;
      };

      await expect(
        withRetry(mockOperation, {
          maxRetries: 3,
          sleepFn: async () => {},
        })
      ).rejects.toThrow("Bad Request: invalid prompt");

      // Non-retryable error must not waste time retrying
      expect(attempts).toBe(1);
    });
  });
});
