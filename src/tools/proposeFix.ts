import fs from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.js";
import { transitionTask } from "../taskEngine.js";
import { resolveSafePath } from "./security.js";
import type { Tool, ToolContext } from "./types.js";

const inputSchema = z.object({
  file_path: z.string().min(1, "File path is required"),
  old_text: z.string().min(1, "Old text to replace is required"),
  new_text: z.string(),
  explanation: z.string().min(1, "Explanation for the fix is required"),
});

export type ProposeFixInput = z.infer<typeof inputSchema>;

export interface FixProposal {
  filePath: string;
  oldText: string;
  newText: string;
  explanation: string;
  proposedAt: string;
}

/**
 * Counts occurrences of a non-empty substring in a string.
 */
export function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

export const proposeFixTool: Tool<ProposeFixInput> = {
  name: "propose_fix",
  description:
    "Propose a targeted code modification for human review. Checks that old_text appears exactly once. Pauses task in 'waiting_for_human' without modifying files.",
  inputSchema,
  parameters: {
    type: "OBJECT",
    properties: {
      file_path: {
        type: "STRING",
        description: "Relative path of the target file to modify.",
      },
      old_text: {
        type: "STRING",
        description:
          "Exact unique code snippet to be replaced. Must appear exactly once in the file.",
      },
      new_text: {
        type: "STRING",
        description: "New code snippet that will replace old_text.",
      },
      explanation: {
        type: "STRING",
        description: "Detailed explanation of why this fix is needed.",
      },
    },
    required: ["file_path", "old_text", "new_text", "explanation"],
  },
  async run(input: ProposeFixInput, context?: ToolContext): Promise<string> {
    // 1. Verify file is within REPO_PATH
    const safeFilePath = resolveSafePath(config.REPO_PATH, input.file_path);

    // 2. Read the existing file
    let fileContent: string;
    try {
      fileContent = await fs.readFile(safeFilePath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return `Error: File '${input.file_path}' does not exist. Use list_files or search_code to locate the correct file.`;
      }
      throw err;
    }

    // 3. Count occurrences of old_text
    const count = countOccurrences(fileContent, input.old_text);

    if (count === 0) {
      return `Error: old_text was not found in '${input.file_path}'. Verify the exact content, spacing, and formatting with read_file before proposing a fix.`;
    }

    if (count > 1) {
      return `Error: old_text appears ${count} times in '${input.file_path}'. Please expand old_text to include unique surrounding lines so it matches exactly once.`;
    }

    // 4. If valid, record proposal and pause task in waiting_for_human
    const proposal: FixProposal = {
      filePath: input.file_path,
      oldText: input.old_text,
      newText: input.new_text,
      explanation: input.explanation,
      proposedAt: new Date().toISOString(),
    };

    if (context?.taskId) {
      await transitionTask({
        taskId: context.taskId,
        toStatus: "waiting_for_human",
        result: { proposal },
        eventType: "fix_proposed",
        payload: proposal as unknown as Record<string, unknown>,
      });
    }

    return `Proposal recorded successfully for '${input.file_path}'. The task is now paused in 'waiting_for_human' status awaiting human approval. No files were modified on disk.`;
  },
};
