import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { errors } from "@/lib/errors";
import { query, queryOne } from "@/server/db/query";
import type { UserRole } from "@/server/db/types";
import type { Permission } from "@/server/auth/permissions";
import { equaliseTiming, hashPassword, needsRehash, verifyPassword } from "@/server/auth/password";
import {
  SESSION_COOKIE,
  type AuthAdapter,
  type AuthSession,
  type SignInCredentials,
} from "@/server/auth/types";

/**
 * Email and password authentication, backed by the `sessions` table.
 *
 * ─── The token ──────────────────────────────────────────────────────────────
 * The cookie carries 32 random bytes. The database stores only its SHA-256, so
 * a leaked backup yields no usable cookies. Plain SHA-256 is correct here and
 * scrypt would be wrong: the input is already full-entropy random, so there is
 * no guessing to slow down, and this runs on every request.
 *
 * ─── Failure is uniform ─────────────────────────────────────────────────────
 * Unknown email, wrong password, disabled account and deleted organisation all
 * produce the same error and take about the same time. Anything more helpful
 * tells an attacker which addresses hold accounts.
 */

const SESSION_TTL_DAYS = 7;

/** Consecutive failures before the account stops accepting attempts. */
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface SessionRow {
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
 * One query resolves the session, the user, the tenant and the employee
 * profile. Session lookup happens on every authenticated request, so the cost
 * of getting it wrong is paid everywhere.
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
    JOIN users u         ON u.id = s.user_id
    JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
   WHERE s.token_hash = $1
     AND s.revoked_at IS NULL
     AND s.expires_at > NOW()
     AND u.deleted_at IS NULL
     AND u.status = 'ACTIVE'
     AND o.deleted_at IS NULL
`;

async function loadOverrides(
  organizationId: string,
  role: UserRole,
): Promise<ReadonlyMap<Permission, boolean>> {
  const rows = await query<{ key: string; granted: boolean }>(
    `SELECT p.key, rp.granted
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.organization_id = $1 AND rp.role = $2::user_role`,
    [organizationId, role],
  );

  return new Map<Permission, boolean>(rows.map((row) => [row.key as Permission, row.granted]));
}

function toSession(row: SessionRow, overrides: ReadonlyMap<Permission, boolean>): AuthSession {
  return {
    user: {
      id: row.user_id,
      email: row.email,
      name: row.user_name,
      avatarUrl: row.user_avatar_url,
      role: row.role,
    },
    organization: {
      id: row.organization_id,
      slug: row.organization_slug,
      name: row.organization_name,
      timezone: row.organization_timezone,
    },
    employee: row.employee_id
      ? {
          id: row.employee_id,
          employeeCode: row.employee_code!,
          firstName: row.first_name!,
          lastName: row.last_name!,
          designation: row.designation!,
          avatarUrl: row.employee_avatar_url,
          departmentId: row.department_id,
          managerId: row.manager_id,
          primaryOfficeId: row.primary_office_id,
        }
      : null,
    permissionOverrides: overrides,
    strategy: "session-cookie",
  };
}

export const passwordAuthAdapter: AuthAdapter = {
  name: "email-password",
  strategy: "session-cookie",

  async getSession() {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const row = await queryOne<SessionRow>(SESSION_SELECT, [hashToken(token)]);
    if (!row) return null;

    // Best-effort liveness for the active-sessions list. A failure here must
    // not deny a request that is otherwise perfectly valid.
    void query(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`, [row.session_id]).catch(
      (error: unknown) => console.error("[auth] failed to record session activity", error),
    );

    return toSession(row, await loadOverrides(row.organization_id, row.role));
  },

  async signIn(credentials: SignInCredentials) {
    if (credentials.kind !== "password") {
      throw errors.precondition(
        `The password adapter cannot handle "${credentials.kind}" sign-in.`,
      );
    }

    const email = credentials.email.trim().toLowerCase();
    const invalid = () => errors.unauthenticated("Incorrect email or password.");

    const account = await queryOne<{
      id: string;
      password_hash: string | null;
      failed_login_attempts: number;
      locked_until: Date | null;
    }>(
      `SELECT u.id, u.password_hash, u.failed_login_attempts, u.locked_until
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = $1
          AND u.deleted_at IS NULL
          AND u.status = 'ACTIVE'
          AND o.deleted_at IS NULL
        ORDER BY u.created_at
        LIMIT 1`,
      [email],
    );

    // No account, or one that authenticates some other way. Pay the hashing
    // cost anyway so this path is not measurably faster than a real attempt.
    if (!account?.password_hash) {
      await equaliseTiming();
      throw invalid();
    }

    if (account.locked_until && account.locked_until > new Date()) {
      throw errors.unauthenticated(
        "Too many failed sign-in attempts. Try again in a few minutes.",
      );
    }

    if (!(await verifyPassword(credentials.password, account.password_hash))) {
      // Lock on the attempt that reaches the limit, counting from whatever the
      // stored value is — concurrent attempts can only overcount, never under.
      await query(
        `UPDATE users
            SET failed_login_attempts = failed_login_attempts + 1,
                locked_until = CASE
                  WHEN failed_login_attempts + 1 >= $2
                  THEN NOW() + ($3 || ' minutes')::INTERVAL
                  ELSE locked_until
                END
          WHERE id = $1`,
        [account.id, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MINUTES)],
      );
      throw invalid();
    }

    // Upgrade the stored verifier when the cost parameters have moved on. This
    // is the only moment the plaintext is available to do it.
    if (needsRehash(account.password_hash)) {
      const upgraded = await hashPassword(credentials.password);
      await query(
        `UPDATE users SET password_hash = $2, password_updated_at = NOW() WHERE id = $1`,
        [account.id, upgraded],
      );
    }

    await query(
      `UPDATE users
          SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW()
        WHERE id = $1`,
      [account.id],
    );

    const token = randomBytes(TOKEN_BYTES).toString("base64url");

    const created = await queryOne<{ token_hash: string }>(
      `INSERT INTO sessions (organization_id, user_id, token_hash, expires_at)
       SELECT u.organization_id, u.id, $2, NOW() + ($3 || ' days')::INTERVAL
         FROM users u
        WHERE u.id = $1
       RETURNING token_hash`,
      [account.id, hashToken(token), String(SESSION_TTL_DAYS)],
    );

    if (!created) throw errors.internal("Could not establish a session.");

    const row = await queryOne<SessionRow>(SESSION_SELECT, [created.token_hash]);
    if (!row) throw errors.internal("Session was created but could not be read back.");

    return { session: toSession(row, await loadOverrides(row.organization_id, row.role)), token };
  },

  async signOut() {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;

    if (token) {
      // Revoked rather than deleted, so "signed out at 14:02" stays auditable.
      await query(
        `UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashToken(token)],
      );
    }

    store.delete(SESSION_COOKIE);
  },
};

/**
 * Set a user's password. Exported for the seed and for future
 * administrator-initiated resets; there is no self-service reset flow yet.
 */
export async function setPassword(userId: string, plaintext: string): Promise<void> {
  await query(
    `UPDATE users
        SET password_hash = $2,
            password_updated_at = NOW(),
            failed_login_attempts = 0,
            locked_until = NULL,
            provider = 'PASSWORD'
      WHERE id = $1`,
    [userId, await hashPassword(plaintext)],
  );
}

/** Revoke every session for a user — "sign out everywhere", and on password change. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE sessions SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [userId],
  );
  return rows.length;
}
