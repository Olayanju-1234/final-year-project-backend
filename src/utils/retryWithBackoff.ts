import { logger } from '@/utils/logger';

/**
 * Retry an async operation with exponential backoff.
 *
 * @param fn         The operation to retry. Must be idempotent (safe to call multiple times).
 * @param opts.maxAttempts  Max number of attempts including the first (default: 4)
 * @param opts.baseDelayMs  Initial delay in ms, doubles each retry (default: 500)
 * @param opts.label  Context string for log messages
 *
 * Delay sequence for baseDelayMs=500: 500ms → 1000ms → 2000ms
 * Total max wait for 4 attempts: ~3.5s
 *
 * This is intentionally simple — no persistent queue, no Redis.
 * Failures after maxAttempts propagate so callers can revert state.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const { maxAttempts = 4, baseDelayMs = 500, label = 'operation' } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(`${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  logger.error(`${label} failed after ${maxAttempts} attempts`, {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw lastError;
}
