/**
 * Sliding Window Rate Limiter Utility
 * Used for authentication brute-force protection and API throttling.
 */

interface RateLimitRecord {
  timestamps: number[];
}

const store = new Map<string, RateLimitRecord>();

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 5,
  windowMs: number = 60_000
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = store.get(identifier);
  if (!record) {
    record = { timestamps: [] };
    store.set(identifier, record);
  }

  // Filter timestamps within current window
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (record.timestamps.length >= maxRequests) {
    const oldest = record.timestamps[0];
    const resetMs = oldest ? oldest + windowMs - now : windowMs;
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - record.timestamps.length,
    resetMs: windowMs,
  };
}
