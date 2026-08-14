import "server-only";

/**
 * Fixed-window rate limiting, behind a swappable store.
 *
 * ─── Honest scope of the default store ──────────────────────────────────────
 * `InMemoryStore` keeps counters in the process. On ONE instance that is the
 * whole story. Across N replicas the effective limit becomes N× the configured
 * one, because each process counts separately. It is NOT distributed, and
 * nothing in this codebase should describe it as such.
 *
 * That is an acceptable floor for a single Railway instance and for the abuse
 * this guards against — someone hammering login or check-in. It is NOT
 * adequate once the service is scaled horizontally, and the login limiter in
 * particular should move to Redis before that happens.
 *
 * ─── Migrating to Redis ─────────────────────────────────────────────────────
 * Implement `RateLimitStore` with INCR + EXPIRE and register it in
 * `resolveStore()`. No caller changes: `consume()` keeps its signature.
 *
 *     RateLimitStore
 *          ├── InMemoryStore   (default, per-process)
 *          └── RedisStore      (shared, correct under horizontal scaling)
 *
 * A second, independent line of defence already exists for the two paths that
 * matter most, and it *is* shared because it lives in PostgreSQL:
 *   · login    — `users.failedLoginAttempts` / `lockedUntil`
 *   · check-in — every attempt is written to `attendance_events`
 * So even with the per-process limiter, brute force is bounded by the database
 * and abuse is visible in the audit trail.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  readonly name: string;
  /** True only for a store shared across every instance. */
  readonly distributed: boolean;
  consume(key: string, limit: number, windowSeconds: number): RateLimitResult;
  reset(): void;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Per-process fixed window. Correct for one instance; approximate for many. */
class InMemoryStore implements RateLimitStore {
  readonly name = "in-memory";
  readonly distributed = false;

  private windows = new Map<string, Window>();

  /** Evict expired windows so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (this.windows.size < 5000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  consume(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    this.sweep(now);

    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
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

  reset(): void {
    this.windows.clear();
  }
}

let store: RateLimitStore = new InMemoryStore();

/** Swap the store — Redis in production, a fake in tests. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

export function rateLimitStoreInfo(): { name: string; distributed: boolean } {
  return { name: store.name, distributed: store.distributed };
}

export function consume(key: string, limit: number, windowSeconds: number): RateLimitResult {
  return store.consume(key, limit, windowSeconds);
}

/** Limits tuned per operation class. */
export const RATE_LIMITS = {
  /** Attendance actions: room for a flaky GPS retry, tight enough that
   *  scanning for a geofence boundary is impractical. */
  attendanceAction: { limit: 10, windowSeconds: 60 },
  /** Any write. */
  mutation: { limit: 60, windowSeconds: 60 },
  /** Search / read-heavy endpoints. */
  read: { limit: 240, windowSeconds: 60 },
  /** Sign-in, per account. Mirrors the database lockout. */
  loginPerAccount: { limit: 5, windowSeconds: 15 * 60 },
  /** Sign-in, per IP — catches spraying across many accounts. */
  loginPerIp: { limit: 20, windowSeconds: 15 * 60 },
} as const;

export function rateLimitKey(operation: string, ...parts: Array<string | null | undefined>): string {
  return [operation, ...parts.filter(Boolean)].join(":");
}

/** Test hook — clears all windows. */
export function __resetRateLimits(): void {
  store.reset();
}
