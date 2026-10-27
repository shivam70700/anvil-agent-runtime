import { recordTaskEvent, transitionTask } from "../taskEngine.js";
import type { Task } from "../types.js";
import { runAgentLoop } from "./loop.js";
import type { AgentLoopOptions, AgentLoopResult } from "./types.js";

/**
 * Executes a claimed task through the autonomous agent loop:
 * 1. Derives the question or prompt from the task's input payload.
 * 2. Attaches an event listener that records every LLM turn, tool call, output,
 *    and error directly into the task_events diary in real time.
 * 3. Transitions the task to 'completed' with its final answer or 'failed' with its error.
 */
export async function executeTaskWithAgent(
  task: Task,
  options?: Partial<AgentLoopOptions>
): Promise<AgentLoopResult> {
  const input = (task.input ?? {}) as Record<string, unknown>;
  const question =
    typeof input["query"] === "string"
      ? input["query"]
      : typeof input["question"] === "string"
      ? input["question"]
      : JSON.stringify(input);

  const loopResult = await runAgentLoop({
    question,
    taskId: task.id,
    llm: options?.llm,
    tools: options?.tools,
    maxSteps: options?.maxSteps,
    onEvent: async (event) => {
      // Persist each agent step into task_events
      await recordTaskEvent({
        taskId: task.id,
        eventType: event.type,
        payload: {
          step: event.step,
          ...event.payload,
        },
        fromStatus: "running",
        toStatus: "running",
      });

      if (options?.onEvent) {
        await options.onEvent(event);
      }
    },
  });

  // Final status transition
  if (loopResult.status === "waiting_for_human") {
    // The propose_fix tool already transitioned the task into 'waiting_for_human'
    return loopResult;
  } else if (loopResult.status === "completed") {
    await transitionTask({
      taskId: task.id,
      toStatus: "completed",
      result: {
        answer: loopResult.answer,
        steps: loopResult.steps,
      },
    });
  } else {
    await transitionTask({
      taskId: task.id,
      toStatus: "failed",
      error: loopResult.error ?? "Task stopped without completing",
      result: {
        lastAnswer: loopResult.answer,
        steps: loopResult.steps,
      },
    });
  }

  return loopResult;
}
