/**
 * Embedding vector dimension for Google Gemini embedding models
 * (e.g., text-embedding-004 and gemini-embedding-001).
 */
export const EMBEDDING_DIMENSION = 768;

export interface CodeChunk {
  id: number;
  repo: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  embedding?: number[] | null;
  created_at?: Date;
  updated_at?: Date;
}

export type SearchMode = "keyword" | "semantic" | "hybrid";

export interface SearchResult {
  chunkId: number;
  repo: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  mode: SearchMode;
}
