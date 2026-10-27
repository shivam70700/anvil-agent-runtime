export interface ChunkSpan {
  startLine: number;
  endLine: number;
  content: string;
}

export const DEFAULT_CHUNK_SIZE = 40;
export const DEFAULT_CHUNK_OVERLAP = 10;

/**
 * Splits source code text into ~40-line chunks with a 10-line sliding overlap.
 * 
 * Line numbers are 1-indexed.
 * If total lines <= chunkSize, returns a single chunk.
 */
export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP
): ChunkSpan[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;

  if (totalLines <= chunkSize) {
    return [
      {
        startLine: 1,
        endLine: totalLines,
        content: text,
      },
    ];
  }

  const step = Math.max(1, chunkSize - overlap);
  const chunks: ChunkSpan[] = [];

  for (let start = 0; start < totalLines; start += step) {
    const end = Math.min(start + chunkSize, totalLines);
    const chunkLines = lines.slice(start, end);

    chunks.push({
      startLine: start + 1, // 1-indexed
      endLine: end,
      content: chunkLines.join("\n"),
    });

    if (end >= totalLines) {
      break;
    }
  }

  return chunks;
}
