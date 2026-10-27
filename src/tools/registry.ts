import type { ToolDefinition } from "../llm/types.js";
import { listFilesTool } from "./listFiles.js";
import { proposeFixTool } from "./proposeFix.js";
import { readFileTool } from "./readFile.js";
import { searchCodeTool } from "./searchCode.js";
import type { Tool, ToolContext } from "./types.js";

export interface ToolExecutionResult {
  success: boolean;
  output: string;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    // Register standard default tools
    this.register(listFilesTool);
    this.register(readFileTool);
    this.register(searchCodeTool);
    this.register(proposeFixTool);
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async execute(
    name: string,
    rawArgs: unknown,
    context?: ToolContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: `Tool '${name}' is not registered. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
      };
    }

    // 1. Validate arguments using the tool's Zod schema
    const parseResult = tool.inputSchema.safeParse(rawArgs ?? {});
    if (!parseResult.success) {
      return {
        success: false,
        output: `Invalid arguments for tool '${name}': ${JSON.stringify(parseResult.error.flatten().fieldErrors)}`,
      };
    }

    // 2. Execute the tool with sandboxed safety
    try {
      const output = await tool.run(parseResult.data, context);
      return {
        success: true,
        output,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Error executing tool '${name}': ${err.message}`,
      };
    }
  }
}

export const defaultToolRegistry = new ToolRegistry();
