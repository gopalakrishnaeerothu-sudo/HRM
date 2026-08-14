import "server-only";

/**
 * Fixed-window rate limiter.
 *
 * ─── Scope of this implementation ────────────────────────────────────────────
 * State lives in the process, so the limit is *per instance*. On a single
 * Railway container that is the whole story; scaled to N replicas the
 * effective limit becomes N× the configured one. That is an acceptable floor
 * for the abuse this guards against (someone hammering check-in to brute-force
 * a geofence), and it is honest to say so rather than to imply a distributed
 * guarantee that is not here.
 *
 * To make it cluster-wide, swap the Map for Redis `INCR` + `EXPIRE`; the
 * `consume` signature does not change.
 *
 * The durable record is separate: every check-in attempt is written to
 * `attendance_events` regardless of the outcome, so a burst is visible in the
 * audit trail even if the limiter let it through.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Evict expired windows so the map cannot grow without bound. */
function sweep(now: number): void {
  if (windows.size < 5000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function consume(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Limits tuned per operation class. */
export const RATE_LIMITS = {
  /** Attendance actions: generous enough for a flaky GPS retry, tight enough
   *  that scanning for a geofence boundary is impractical. */
  attendanceAction: { limit: 10, windowSeconds: 60 },
  /** Any write. */
  mutation: { limit: 60, windowSeconds: 60 },
  /** Search / read-heavy endpoints. */
  read: { limit: 240, windowSeconds: 60 },
} as const;

export function rateLimitKey(operation: string, ...parts: Array<string | null | undefined>): string {
  return [operation, ...parts.filter(Boolean)].join(":");
}

/** Test hook — resets all windows. */
export function __resetRateLimits(): void {
  windows.clear();
}
