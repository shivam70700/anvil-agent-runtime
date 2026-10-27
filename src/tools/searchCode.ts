import { z } from "zod";
import { createEmbedder } from "../search/embedder.js";
import { hybridSearch } from "../search/hybridSearch.js";
import { keywordSearch } from "../search/keywordSearch.js";
import { semanticSearch } from "../search/semanticSearch.js";
import type { SearchMode, SearchResult } from "../search/types.js";
import type { Tool } from "./types.js";

const inputSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  mode: z.enum(["keyword", "semantic", "hybrid"]).default("hybrid"),
  limit: z.number().int().min(1).max(15).default(5),
});

type InputType = z.infer<typeof inputSchema>;

export const searchCodeTool: Tool<InputType> = {
  name: "search_code",
  description:
    "Search the repository for code snippets, functions, or concepts using keyword, semantic, or hybrid search.",
  inputSchema,
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "The search query (function name, error message, or concept).",
      },
      mode: {
        type: "STRING",
        description: "Search mode: 'keyword', 'semantic', or 'hybrid' (default).",
        enum: ["keyword", "semantic", "hybrid"],
      },
      limit: {
        type: "NUMBER",
        description: "Maximum number of results to return (default: 5).",
      },
    },
    required: ["query"],
  },
  async run(input: InputType): Promise<string> {
    const limit = input.limit ?? 5;
    const mode = (input.mode ?? "hybrid") as SearchMode;
    const embedder = createEmbedder();

    let results: SearchResult[] = [];
    if (mode === "keyword") {
      results = await keywordSearch(input.query, { limit });
    } else if (mode === "semantic") {
      results = await semanticSearch(input.query, embedder, { limit });
    } else {
      results = await hybridSearch(input.query, embedder, { limit });
    }

    if (results.length === 0) {
      return `No code snippets found matching '${input.query}'. Try broader terms or check indexed files.`;
    }

    const formatted = results.map((res, i) => {
      return `[Result ${i + 1}] ${res.filePath} (Lines ${res.startLine}-${res.endLine}) [Score: ${res.score}]\n\`\`\`\n${res.content}\n\`\`\``;
    });

    return formatted.join("\n\n");
  },
};
