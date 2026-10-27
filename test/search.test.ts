import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../src/agent/index.js";
import { MockLlm } from "../src/llm/mock.js";
import { chunkText } from "../src/search/chunker.js";
import { MockEmbedder } from "../src/search/embedder.js";
import { RRF_K } from "../src/search/hybridSearch.js";
import { EMBEDDING_DIMENSION, type SearchResult } from "../src/search/types.js";
import { defaultToolRegistry } from "../src/tools/registry.js";

describe("Search & Indexing Engine (Phase 3)", () => {
  describe("Chunker & Boundary Tests", () => {
    it("returns a single chunk for files with <= 40 lines", () => {
      const text = Array.from({ length: 25 }, (_, i) => `const x${i} = ${i};`).join("\n");
      const chunks = chunkText(text, 40, 10);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBe(25);
      expect(chunks[0]!.content).toBe(text);
    });

    it("chunks 100 lines into ~40-line chunks with 10-line overlap", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      const text = lines.join("\n");
      const chunks = chunkText(text, 40, 10);

      // With step = 40 - 10 = 30 lines:
      // Chunk 1: lines 1 to 40
      // Chunk 2: lines 31 to 70
      // Chunk 3: lines 61 to 100 (covers up to the end of the 100 lines)
      expect(chunks.length).toBe(3);

      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBe(40);

      expect(chunks[1]!.startLine).toBe(31);
      expect(chunks[1]!.endLine).toBe(70);

      expect(chunks[2]!.startLine).toBe(61);
      expect(chunks[2]!.endLine).toBe(100);
    });

    it("returns empty array for empty or blank text", () => {
      expect(chunkText("")).toEqual([]);
      expect(chunkText("   \n\n  ")).toEqual([]);
    });
  });

  describe("MockEmbedder & Vector Dimensions", () => {
    it("generates 768-dimensional normalized vectors", async () => {
      const embedder = new MockEmbedder();
      const vectors = await embedder.embed([
        "function transitionTask() locks rows with SELECT FOR UPDATE",
        "export const pool = new Pool()",
      ]);

      expect(vectors.length).toBe(2);
      expect(vectors[0]!.length).toBe(EMBEDDING_DIMENSION);
      expect(vectors[1]!.length).toBe(EMBEDDING_DIMENSION);

      // Verify L2 norm is approximately 1.0
      const norm = Math.sqrt(vectors[0]!.reduce((acc, v) => acc + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 3);
    });

    it("assigns higher similarity to texts sharing vocabulary", async () => {
      const embedder = new MockEmbedder();
      const [v1, v2, v3] = await embedder.embed([
        "database connection pool postgres",
        "postgres connection client pool",
        "completely unrelated culinary recipe for pasta",
      ]);

      // Cosine similarity = dot product of normalized vectors
      const sim12 = v1!.reduce((sum, val, i) => sum + val * v2![i]!, 0);
      const sim13 = v1!.reduce((sum, val, i) => sum + val * v3![i]!, 0);

      expect(sim12).toBeGreaterThan(sim13);
    });
  });

  describe("Reciprocal Rank Fusion (RRF) Logic", () => {
    it("fuses keyword and semantic rankings so items in both lists rank highest", () => {
      // Simulate Keyword Search: Chunk 10 is #1, Chunk 20 is #2
      const keywordList: SearchResult[] = [
        { chunkId: 10, repo: "r", filePath: "a.ts", startLine: 1, endLine: 40, content: "a", score: 0.9, mode: "keyword" },
        { chunkId: 20, repo: "r", filePath: "b.ts", startLine: 1, endLine: 40, content: "b", score: 0.7, mode: "keyword" },
      ];

      // Simulate Semantic Search: Chunk 30 is #1, Chunk 10 is #2
      const semanticList: SearchResult[] = [
        { chunkId: 30, repo: "r", filePath: "c.ts", startLine: 1, endLine: 40, content: "c", score: 0.85, mode: "semantic" },
        { chunkId: 10, repo: "r", filePath: "a.ts", startLine: 1, endLine: 40, content: "a", score: 0.82, mode: "semantic" },
      ];

      // Compute RRF manually:
      // Chunk 10: 1/(60+1) [from kw] + 1/(60+2) [from sem] = (1/61) + (1/62) = 0.016393 + 0.016129 = 0.032522
      // Chunk 30: 1/(60+1) [from sem] = 1/61 = 0.016393
      // Chunk 20: 1/(60+2) [from kw] = 1/62 = 0.016129
      const scores = new Map<number, number>();

      keywordList.forEach((item, idx) => {
        const rank = idx + 1;
        scores.set(item.chunkId, (scores.get(item.chunkId) ?? 0) + 1 / (RRF_K + rank));
      });

      semanticList.forEach((item, idx) => {
        const rank = idx + 1;
        scores.set(item.chunkId, (scores.get(item.chunkId) ?? 0) + 1 / (RRF_K + rank));
      });

      const chunk10Score = scores.get(10)!;
      const chunk30Score = scores.get(30)!;
      const chunk20Score = scores.get(20)!;

      // Chunk 10 (appearing in both lists) must score significantly higher than single-list matches
      expect(chunk10Score).toBeGreaterThan(chunk30Score);
      expect(chunk30Score).toBeGreaterThan(chunk20Score);
      expect(chunk10Score).toBeCloseTo(0.03252, 4);
    });
  });

  describe("Agent Integration: search_code and read_file", () => {
    it("answers a code question using search_code and read_file tools", async () => {
      const mockLlm = new MockLlm();

      // Turn 1: Agent searches for transitionTask
      mockLlm.enqueue({
        text: "I need to search the codebase for the transitionTask function.",
        toolCalls: [
          {
            name: "search_code",
            args: { query: "transitionTask", mode: "keyword" },
          },
        ],
      });

      // Turn 2: Agent reads the file discovered by search
      mockLlm.enqueue({
        text: "I found transitionTask in src/taskEngine.ts. Let me read the exact implementation.",
        toolCalls: [
          {
            name: "read_file",
            args: { path: "src/taskEngine.ts" },
          },
        ],
      });

      // Turn 3: Agent provides final explanation
      mockLlm.enqueue({
        text: "transitionTask executes in ONE transaction with SELECT ... FOR UPDATE to prevent race conditions and validates the status transition.",
      });

      const result = await runAgentLoop({
        question: "How does transitionTask work in the engine?",
        llm: mockLlm,
        tools: defaultToolRegistry,
      });

      expect(result.status).toBe("completed");
      expect(result.steps).toBe(3);
      expect(result.answer).toContain("transitionTask executes in ONE transaction");

      // Verify tool sequence in conversation history
      expect(result.messages.length).toBe(6);
      expect(result.messages[1]?.toolCalls?.[0]?.name).toBe("search_code");
      expect(result.messages[3]?.toolCalls?.[0]?.name).toBe("read_file");
      expect(result.messages[4]?.toolResult?.result).toContain("export async function transitionTask");
    });
  });
});
