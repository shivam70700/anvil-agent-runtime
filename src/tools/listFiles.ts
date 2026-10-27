import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import { resolveSafePath } from "./security.js";
import type { Tool } from "./types.js";

const inputSchema = z.object({
  path: z.string().default("."),
});

type InputType = z.infer<typeof inputSchema>;

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".env",
  ".DS_Store",
]);

export const listFilesTool: Tool<InputType> = {
  name: "list_files",
  description:
    "List files and directories in a repository folder. Returns relative paths.",
  inputSchema,
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "Relative directory path to list (default is root '.').",
      },
    },
  },
  async run(input: InputType): Promise<string> {
    const safeDir = resolveSafePath(config.REPO_PATH, input.path ?? ".");

    try {
      const stats = await fs.stat(safeDir);
      if (!stats.isDirectory()) {
        return `Error: '${input.path}' is a file, not a directory.`;
      }

      const entries = await fs.readdir(safeDir, { withFileTypes: true });
      const visible = entries
        .filter((entry) => !IGNORED_NAMES.has(entry.name))
        .map((entry) => {
          const type = entry.isDirectory() ? "dir" : "file";
          const relPath = path.relative(config.REPO_PATH, path.join(safeDir, entry.name));
          return `[${type}] ${relPath}`;
        });

      if (visible.length === 0) {
        return "Directory is empty.";
      }

      return visible.join("\n");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return `Directory not found: ${input.path}`;
      }
      throw err;
    }
  },
};
