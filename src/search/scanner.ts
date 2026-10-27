import fs from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".gemini",
  "brain",
  "scratch",
  ".next",
  ".cache",
]);

const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".lock",
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB limit

/**
 * Checks if a buffer contains null bytes (indicator of binary files)
 */
function isBinaryBuffer(buffer: Buffer): boolean {
  const bytesToCheck = Math.min(buffer.length, 512);
  for (let i = 0; i < bytesToCheck; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively scans directory and yields valid, indexable text source files.
 */
export async function scanSourceFiles(rootDir: string): Promise<string[]> {
  const absoluteRoot = path.resolve(rootDir);
  const matchedFiles: string[] = [];

  async function walk(currentDir: string) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IGNORED_EXTENSIONS.has(ext)) {
          continue;
        }

        // Check file size
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size === 0 || stat.size > MAX_FILE_SIZE) {
            continue;
          }

          // Inspect first 512 bytes for binary characters
          const fd = await fs.open(fullPath, "r");
          try {
            const buf = Buffer.alloc(Math.min(stat.size, 512));
            await fd.read(buf, 0, buf.length, 0);
            if (isBinaryBuffer(buf)) {
              continue;
            }
          } finally {
            await fd.close();
          }

          // Relative path from rootDir
          const relPath = path.relative(absoluteRoot, fullPath);
          matchedFiles.push(relPath);
        } catch {
          continue;
        }
      }
    }
  }

  await walk(absoluteRoot);
  return matchedFiles.sort();
}
