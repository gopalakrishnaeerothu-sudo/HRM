import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { isProduction } from "@/lib/env";
import { SESSION_COOKIE } from "@/server/auth/types";

/**
 * Server-side session storage.
 *
 * ─── The shape of a session ─────────────────────────────────────────────────
 * A session is a 256-bit random token held in an HttpOnly cookie. Only its
 * SHA-256 is stored, so a database leak yields no usable sessions. There is no
 * JWT: revocation is the common case in an HR product (someone leaves, an
 * admin disables an account), and a stateless token cannot be revoked without
 * building the very lookup table a session row already is.
 *
 * SHA-256 without a work factor is correct here and would be wrong for a
 * password: the input is 256 bits of CSPRNG output, so there is nothing to
 * brute-force. Work factors exist to slow guessing of low-entropy secrets.
 *
 * ─── Lifetimes ──────────────────────────────────────────────────────────────
 * Absolute: 7 days. A session dies then regardless of activity.
 * Idle: 12 hours. Sliding, refreshed on use, so an unattended laptop stops
 * being a way in overnight while a working day never logs you out.
 */

const ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

/** Only refresh `lastUsedAt` when it is this stale, to avoid a write per request. */
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 256 bits from the CSPRNG, URL-safe. */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export const sessionStore = {
  /**
   * Issue a session. Returns the raw token — the only moment it exists
   * outside the caller's cookie.
   */
  async create(
    userId: string,
    organizationId: string,
    context: SessionContext = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + ABSOLUTE_LIFETIME_MS);

    await prisma.session.create({
      data: {
        userId,
        organizationId,
        tokenHash: hashToken(token),
        expiresAt,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
      },
    });

    return { token, expiresAt };
  },

  /**
   * Resolve a token to a live session.
   *
   * Enforces, in order: existence, revocation, absolute expiry, idle timeout.
   * Returns null for all of them — a caller cannot tell *why* a session was
   * rejected, which keeps session-probing uninformative.
   */
  async resolve(token: string): Promise<{ userId: string; organizationId: string; sessionId: string } | null> {
    if (!token || token.length < 20) return null;

    const tokenHash = hashToken(token);

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        tokenHash: true,
      },
    });

    if (!session) return null;

    // Defence in depth against a theoretical hash collision or a partial-match
    // lookup: compare the stored digest in constant time as well.
    const provided = Buffer.from(tokenHash, "hex");
    const stored = Buffer.from(session.tokenHash, "hex");
    if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) return null;

    const now = Date.now();
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= now) return null;
    if (now - session.lastUsedAt.getTime() > IDLE_TIMEOUT_MS) {
      // Idle too long: revoke rather than merely reject, so the row cannot be
      // revived by a later request that happens to arrive sooner.
      await prisma.session
        .update({ where: { id: session.id }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
      return null;
    }

    // Sliding window, written at most once per interval.
    if (now - session.lastUsedAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
      await prisma.session
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }

    return { userId: session.userId, organizationId: session.organizationId, sessionId: session.id };
  },

  /**
   * Replace a session with a fresh one, carrying the same identity.
   *
   * Called immediately after a successful sign-in against a request that
   * already had a session cookie. That is the fix for session fixation: an
   * attacker who plants a known cookie value before login finds that value
   * dead afterwards.
   */
  async rotate(
    oldToken: string | null,
    userId: string,
    organizationId: string,
    context: SessionContext = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const issued = await this.create(userId, organizationId, context);

    if (oldToken) {
      const newSession = await prisma.session.findUnique({
        where: { tokenHash: hashToken(issued.token) },
        select: { id: true },
      });

      await prisma.session
        .updateMany({
          where: { tokenHash: hashToken(oldToken), revokedAt: null },
          data: { revokedAt: new Date(), rotatedToId: newSession?.id ?? null },
        })
        .catch(() => undefined);
    }

    return issued;
  },

  /** Revoke one session. Idempotent. */
  async revoke(token: string): Promise<void> {
    await prisma.session
      .updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  },

  /**
   * Revoke every live session for a user.
   * Used on password change and on account deactivation — both are moments
   * where existing sessions must stop working immediately.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  },

  /**
   * Delete sessions that expired more than a day ago.
   * Nothing calls this on a timer yet; it is exposed for a scheduled job.
   * Expired rows are already unusable, so this is hygiene, not security.
   */
  async pruneExpired(): Promise<number> {
    const result = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    return result.count;
  },
};

// --- Cookie handling --------------------------------------------------------

/**
 * `secure` is on whenever the app runs in production, so the cookie never
 * crosses plain HTTP there. It is off in development because localhost is not
 * HTTPS and a secure cookie would simply be dropped.
 *
 * `sameSite: "lax"` blocks the cookie on cross-site POSTs — the classic CSRF
 * shape — while still allowing normal top-level navigation into the app. The
 * route wrapper's origin check is the second layer.
 */
function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(new Date(0)), maxAge: 0 });
}

export const SESSION_LIFETIME = {
  absoluteMs: ABSOLUTE_LIFETIME_MS,
  idleMs: IDLE_TIMEOUT_MS,
};
