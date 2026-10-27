import path from "node:path";

export class PathEscapeError extends Error {
  constructor(attemptedPath: string) {
    super(`Access denied: path '${attemptedPath}' escapes repository root`);
    this.name = "PathEscapeError";
  }
}

/**
 * Resolves a user-provided relative path against repoRoot and strictly verifies
 * that the resolved path does not traverse outside of repoRoot.
 */
export function resolveSafePath(repoRoot: string, userPath: string): string {
  const resolvedRoot = path.resolve(repoRoot);
  // path.resolve(resolvedRoot, userPath) handles relative segments like "foo/bar"
  // Note: if userPath is absolute (e.g. "/etc/passwd"), path.resolve treats it as root,
  // which will fail the startsWith check below.
  const targetPath = path.resolve(resolvedRoot, userPath);

  if (targetPath !== resolvedRoot && !targetPath.startsWith(resolvedRoot + path.sep)) {
    throw new PathEscapeError(userPath);
  }

  return targetPath;
}
