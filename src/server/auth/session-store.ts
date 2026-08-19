import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { execute, query, queryExactlyOne, queryOne, type Executor } from "@/server/db/query";
import type { UserRole } from "@/server/db/types";

/**
 * Server-side session storage.
 *
 * ─── The token ──────────────────────────────────────────────────────────────
 * The cookie carries 32 random bytes, base64url-encoded. Only its SHA-256 is
 * stored, so a leaked database backup yields nothing replayable. Plain SHA-256
 * is right here and Argon2 would be wrong: the input is already full-entropy
 * random, so there is no guessing to slow down, and this lookup runs on every
 * authenticated request.
 *
 * ─── Lifetime ───────────────────────────────────────────────────────────────
 * Fourteen days, chosen rather than defaulted: long enough that someone
 * checking attendance weekly is not re-authenticating every visit, short
 * enough that a session taken from an unattended machine dies within a
 * fortnight even if nobody notices.
 *
 * Expiry is absolute, not sliding — a stolen token cannot be kept alive
 * indefinitely by the thief simply continuing to use it. `last_seen_at` is
 * refreshed for the active-sessions list, and gives the evidence to shorten
 * this later from real idle patterns rather than a guess.
 */

export const SESSION_TTL_DAYS = 14;

const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Everything an authenticated request needs, resolved in one row. */
export interface SessionRow {
  session_id: string;
  user_id: string;
  email: string;
  user_name: string;
  user_avatar_url: string | null;
  role: UserRole;
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  organization_timezone: string;
  employee_id: string | null;
  employee_code: string | null;
  first_name: string | null;
  last_name: string | null;
  designation: string | null;
  employee_avatar_url: string | null;
  department_id: string | null;
  manager_id: string | null;
  primary_office_id: string | null;
}

/**
 * Session, user, tenant and employee profile in one statement.
 *
 * The status and soft-delete filters are part of the lookup rather than a
 * check afterwards, so disabling an account or deleting an organisation takes
 * effect on the very next request with no session sweep required.
 */
const SESSION_SELECT = `
  SELECT s.id                AS session_id,
         u.id                AS user_id,
         u.email,
         u.name              AS user_name,
         u.avatar_url        AS user_avatar_url,
         u.role,
         o.id                AS organization_id,
         o.slug              AS organization_slug,
         o.name              AS organization_name,
         o.timezone          AS organization_timezone,
         e.id                AS employee_id,
         e.employee_code,
         e.first_name,
         e.last_name,
         e.designation,
         e.avatar_url        AS employee_avatar_url,
         e.department_id,
         e.manager_id,
         e.primary_office_id
    FROM sessions s
    JOIN users u          ON u.id = s.user_id
    JOIN organizations o  ON o.id = u.organization_id
    LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
   WHERE s.token_hash = $1
     AND s.revoked_at IS NULL
     AND s.expires_at > NOW()
     AND u.deleted_at IS NULL
     AND u.status = 'ACTIVE'
     AND o.deleted_at IS NULL
`;

/** Issue a session. The returned token is the only time it exists in the clear. */
export async function createSession(
  userId: string,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
  executor?: Executor,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  const row = await queryExactlyOne<{ id: string; expires_at: Date }>(
    `INSERT INTO sessions (organization_id, user_id, token_hash, expires_at, ip_address, user_agent)
     SELECT u.organization_id, u.id, $2, NOW() + ($3 || ' days')::INTERVAL, $4::inet, $5
       FROM users u
      WHERE u.id = $1
     RETURNING id, expires_at`,
    [
      userId,
      hashToken(token),
      String(SESSION_TTL_DAYS),
      context.ipAddress ?? null,
      context.userAgent ?? null,
    ],
    executor,
  );

  return { token, sessionId: row.id, expiresAt: row.expires_at };
}

/** Look up a live session by raw token. Null when absent, expired, revoked or disabled. */
export async function findSession(token: string, executor?: Executor): Promise<SessionRow | null> {
  return queryOne<SessionRow>(SESSION_SELECT, [hashToken(token)], executor);
}

/**
 * Record that a session was used.
 *
 * Callers deliberately do not await this: it is telemetry for the
 * active-sessions list, and failing to write it must not deny a request that
 * is otherwise perfectly valid.
 */
export async function touchSession(sessionId: string, executor?: Executor): Promise<void> {
  await execute(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`, [sessionId], executor);
}

/** End one session. Revoking an already-revoked session is not an error. */
export async function revokeSession(
  token: string,
  reason: string,
  executor?: Executor,
): Promise<boolean> {
  const affected = await execute(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token), reason],
    executor,
  );

  return affected > 0;
}

/**
 * End every session a user holds.
 *
 * Used on password change, on account disable, and by "sign out everywhere".
 * Returns the count so the caller can audit how many were actually ended.
 */
export async function revokeAllSessions(
  userId: string,
  reason: string,
  options: { exceptSessionId?: string } = {},
  executor?: Executor,
): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND ($3::uuid IS NULL OR id <> $3::uuid)
     RETURNING id`,
    [userId, reason, options.exceptSessionId ?? null],
    executor,
  );

  return rows.length;
}

/**
 * Delete sessions long expired or revoked.
 *
 * Not scheduled — this deployment has no cron. Exported so an operator or a
 * future job can call it, and so the table's growth is a known and addressed
 * thing rather than an oversight.
 */
export async function pruneSessions(olderThanDays = 30, executor?: Executor): Promise<number> {
  return execute(
    `DELETE FROM sessions
      WHERE (expires_at < NOW() - ($1 || ' days')::INTERVAL)
         OR (revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 || ' days')::INTERVAL)`,
    [String(olderThanDays)],
    executor,
  );
}
