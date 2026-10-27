export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
}

/**
 * Checks whether an error is transient and safe to retry.
 * Matches HTTP 429 (Rate Limit) and HTTP 5xx (Server Errors).
 */
export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as any;

  // Check numeric HTTP status codes
  const status = anyErr.status ?? anyErr.statusCode ?? anyErr.response?.status;
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }

  // Check common error messages and gRPC status codes
  const message = String(anyErr.message ?? "").toLowerCase();
  if (
    message.includes("429") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("quota exceeded") ||
    message.includes("503") ||
    message.includes("500") ||
    message.includes("service unavailable") ||
    message.includes("internal server error") ||
    message.includes("fetch failed") ||
    message.includes("econnreset")
  ) {
    return true;
  }

  return false;
}

/**
 * Wraps an asynchronous operation with exponential backoff retries.
 *
 * Example delays with initialDelayMs=500, backoffFactor=2:
 * - After Attempt 1 fails: wait 500ms
 * - After Attempt 2 fails: wait 1000ms
 * - After Attempt 3 fails: wait 2000ms
 * - After Attempt 4 fails: abort and rethrow
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.initialDelayMs ?? 500;
  const factor = options.backoffFactor ?? 2;
  const sleep =
    options.sleepFn ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err: any) {
      attempt++;
      if (attempt > maxRetries || !isRetryableError(err)) {
        throw err;
      }

      // Calculate exponential wait: initialDelay * factor^(attempt - 1)
      const delayMs = initialDelay * Math.pow(factor, attempt - 1);

      if (options.onRetry) {
        options.onRetry(attempt, delayMs, err);
      } else {
        console.warn(
          `[LLM Retry] Attempt ${attempt} failed with transient error (${err.message}). Retrying in ${delayMs}ms...`
        );
      }

      await sleep(delayMs);
    }
  }
}
