import fs from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.js";
import { resolveSafePath } from "./security.js";
import type { Tool } from "./types.js";

const inputSchema = z.object({
  path: z.string().min(1, "File path is required"),
});

type InputType = z.infer<typeof inputSchema>;

export const readFileTool: Tool<InputType> = {
  name: "read_file",
  description: "Read the UTF-8 text content of a file in the repository.",
  inputSchema,
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "Relative path of the file to read.",
      },
    },
    required: ["path"],
  },
  async run(input: InputType): Promise<string> {
    const safeFilePath = resolveSafePath(config.REPO_PATH, input.path);

    try {
      const stats = await fs.stat(safeFilePath);
      if (stats.isDirectory()) {
        return `Error: '${input.path}' is a directory, not a file. Use list_files instead.`;
      }

      const content = await fs.readFile(safeFilePath, "utf-8");
      return content;
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return `File not found: ${input.path}`;
      }
      throw err;
    }
  },
};
