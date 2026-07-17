/**
 * Simple in-memory rate limiter for public endpoints.
 * Uses a sliding window per IP address.
 * No external dependencies — designed for single-process $5 VPS deployment.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export function createRateLimiter(config: RateLimitConfig) {
  const { maxRequests, windowMs } = config;
  const store = new Map<string, RateLimitEntry>();

  // Clean up expired entries every 60 seconds
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 60_000);

  // Allow cleanup timer to be cancelled
  const api = {
    check: (
      key: string
    ): { allowed: boolean; remaining: number; resetAt: number } => {
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || entry.resetAt <= now) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return {
          allowed: true,
          remaining: maxRequests - 1,
          resetAt: now + windowMs,
        };
      }

      entry.count++;
      if (entry.count > maxRequests) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
      }

      return {
        allowed: true,
        remaining: maxRequests - entry.count,
        resetAt: entry.resetAt,
      };
    },
    destroy: () => {
      clearInterval(cleanupTimer);
      store.clear();
    },
  };

  return api;
}
