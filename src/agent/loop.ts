import { createLlmClient } from "../llm/index.js";
import type { LlmMessage } from "../llm/types.js";
import { defaultToolRegistry } from "../tools/registry.js";
import type {
  AgentEvent,
  AgentLoopOptions,
  AgentLoopResult,
} from "./types.js";

const DEFAULT_MAX_STEPS = 8;

/**
 * Runs the autonomous ReAct (Reason + Act) loop for a given question.
 *
 * Each step:
 * 1. Sends current message history and available tools to the LLM.
 * 2. If the LLM produces a final text answer without tool calls, terminates successfully.
 * 3. If the LLM requests a tool call, executes the tool, appends the output to history, and repeats.
 * 4. Stops when a final answer is produced or after 8 steps (circuit breaker).
 */
export async function runAgentLoop(
  options: AgentLoopOptions
): Promise<AgentLoopResult> {
  const llm = options.llm ?? createLlmClient();
  const tools = options.tools ?? defaultToolRegistry;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  const messages: LlmMessage[] = [
    {
      role: "user",
      text: options.question,
    },
  ];

  async function emit(
    type: AgentEvent["type"],
    step: number,
    payload: Record<string, unknown>
  ) {
    if (options.onEvent) {
      await options.onEvent({
        type,
        step,
        payload,
        timestamp: new Date(),
      });
    }
  }

  let step = 1;
  let lastResponseText = "";

  try {
    for (; step <= maxSteps; step++) {
      const toolDefs = tools.getDefinitions();

      // 1. Emit LLM call event
      await emit("llm_call", step, {
        messageCount: messages.length,
        availableTools: toolDefs.map((t) => t.name),
      });

      // 2. Query the LLM
      const response = await llm.generate(messages, toolDefs);
      lastResponseText = response.text ?? "";

      // 3. Emit LLM response event
      await emit("llm_response", step, {
        text: response.text,
        toolCalls: response.toolCalls,
      });

      // 4. Record model turn in conversation history
      messages.push({
        role: "model",
        text: response.text,
        toolCalls: response.toolCalls,
      });

      // 5. If no tool calls were requested, this is the final answer!
      if (!response.toolCalls || response.toolCalls.length === 0) {
        await emit("agent_completed", step, {
          answer: lastResponseText,
          totalSteps: step,
        });

        return {
          status: "completed",
          answer: lastResponseText,
          steps: step,
          messages,
        };
      }

      // 6. Execute all requested tool calls
      for (const call of response.toolCalls) {
        await emit("tool_call", step, {
          toolName: call.name,
          args: call.args,
        });

        const execResult = await tools.execute(call.name, call.args, {
          taskId: options.taskId,
        });

        await emit("tool_result", step, {
          toolName: call.name,
          success: execResult.success,
          output: execResult.output,
        });

        // Add tool result to history so LLM can read the observation
        messages.push({
          role: "user",
          toolResult: {
            name: call.name,
            result: execResult.output,
          },
        });

        // If propose_fix succeeded, the task was transitioned to waiting_for_human.
        // Halt the agent loop immediately so the human can review.
        if (call.name === "propose_fix" && execResult.success) {
          await emit("agent_completed", step, {
            status: "waiting_for_human",
            answer: execResult.output,
          });

          return {
            status: "waiting_for_human",
            answer: execResult.output,
            steps: step,
            messages,
          };
        }
      }
    }

    // If loop finished all maxSteps without a final answer
    const limitError = `Agent exceeded maximum step limit of ${maxSteps} steps without completing.`;
    await emit("step_limit_exceeded", maxSteps, {
      maxSteps,
      lastResponseText,
    });

    return {
      status: "step_limit_exceeded",
      answer: lastResponseText,
      error: limitError,
      steps: maxSteps,
      messages,
    };
  } catch (err: any) {
    await emit("agent_failed", step, {
      error: err.message,
    });

    return {
      status: "failed",
      answer: lastResponseText,
      error: err.message,
      steps: step,
      messages,
    };
  }
}
