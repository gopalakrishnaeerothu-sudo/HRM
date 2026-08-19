import "server-only";

import { cookies } from "next/headers";

import { errors } from "@/lib/errors";
import { execute, query, queryOne } from "@/server/db/query";
import type { AuditAction, UserRole, UserStatus } from "@/server/db/types";
import type { Permission } from "@/server/auth/permissions";
import { equaliseTiming, hashPassword, needsRehash, verifyPassword } from "@/server/auth/password";
import {
  createSession,
  findSession,
  revokeAllSessions,
  revokeSession,
  touchSession,
  type SessionRow,
} from "@/server/auth/session-store";
import {
  SESSION_COOKIE,
  type AuthAdapter,
  type AuthSession,
  type SignInCredentials,
} from "@/server/auth/types";
import { auditRepository } from "@/server/repositories/org-repository";
import { consume, RATE_LIMITS, rateLimitKey } from "@/server/services/rate-limit";
import { requestContext } from "@/server/services/audit-service";

/**
 * Production authentication: email and password, Argon2id, database sessions.
 *
 * ─── Failure is uniform ─────────────────────────────────────────────────────
 * Unknown email, wrong password, disabled account, locked account and deleted
 * organisation all produce the same message and take about the same time.
 * Anything more helpful tells an attacker which addresses hold accounts, which
 * is the first half of the attack.
 *
 * The one exception is a locked account, which says so — by that point the
 * caller has already proved they know the password is being rejected
 * repeatedly, and leaving them to guess why is a support ticket rather than a
 * security measure.
 *
 * ─── Brute-force defence, in two layers ─────────────────────────────────────
 * A per-IP limiter blunts volume but is per-instance and defeated by rotating
 * addresses. The layer that actually holds is `users.failed_login_attempts`
 * and `users.locked_until` in PostgreSQL: an attacker cannot rotate the
 * account they are trying to reach, and every Render instance sees the same
 * counter.
 */

/** Consecutive failures before the account stops accepting attempts. */
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;

interface AccountRow {
  id: string;
  organization_id: string;
  status: UserStatus;
  password_hash: string | null;
  failed_login_attempts: number;
  locked_until: Date | null;
}

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

/**
 * Security events are written directly through the repository rather than
 * auditService, because at sign-in time there is no session to attribute them
 * to yet — the actor is identified by user id alone.
 */
async function recordSecurityEvent(
  organizationId: string,
  entry: {
    actorUserId: string | null;
    action: AuditAction;
    summary: string;
    entityId?: string | null;
  },
): Promise<void> {
  const context = await requestContext();

  try {
    await auditRepository.record(
      { organizationId },
      {
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: "users",
        entityId: entry.entityId ?? entry.actorUserId,
        summary: entry.summary,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    );
  } catch (error) {
    // Never block authentication on an audit write, but make it greppable.
    console.error("[auth] failed to record security event", { action: entry.action, error });
  }
}

export const productionAuthAdapter: AuthAdapter = {
  name: "email-password",
  strategy: "session-cookie",

  async getSession() {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const row = await findSession(token);
    if (!row) return null;

    // Not awaited: liveness telemetry must not add latency to, or be able to
    // fail, a request that is otherwise valid.
    void touchSession(row.session_id).catch((error: unknown) =>
      console.error("[auth] failed to record session activity", error),
    );

    return toSession(row, await loadOverrides(row.organization_id, row.role));
  },

  async signIn(credentials: SignInCredentials) {
    if (credentials.kind !== "password") {
      throw errors.precondition(
        `The production adapter handles email and password sign-in; "${credentials.kind}" is not configured.`,
      );
    }

    const context = await requestContext();

    // Network-level throttle. Keyed by address, so it is best-effort — see the
    // note on RATE_LIMITS.signIn.
    const limit = consume(
      rateLimitKey("signIn", context.ipAddress ?? "unknown"),
      RATE_LIMITS.signIn.limit,
      RATE_LIMITS.signIn.windowSeconds,
    );
    if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds);

    const email = credentials.email.trim().toLowerCase();
    const invalid = () => errors.unauthenticated("Incorrect email or password.");

    const account = await queryOne<AccountRow>(
      `SELECT u.id, u.organization_id, u.status, u.password_hash,
              u.failed_login_attempts, u.locked_until
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = $1
          AND u.deleted_at IS NULL
          AND o.deleted_at IS NULL
        ORDER BY u.created_at
        LIMIT 1`,
      [email],
    );

    // No account, or one that authenticates some other way. Pay the
    // verification cost anyway so this path is not measurably faster.
    if (!account?.password_hash) {
      await equaliseTiming();
      // Cannot be audited: audit_logs is tenant-scoped and there is no tenant
      // to attribute an unknown address to. Logged without the address, which
      // would otherwise make this line a list of probed accounts.
      console.warn("[auth] sign-in attempt for unknown or password-less account");
      throw invalid();
    }

    if (account.status === "DISABLED") {
      await equaliseTiming();
      await recordSecurityEvent(account.organization_id, {
        actorUserId: account.id,
        action: "LOGIN_FAILURE",
        summary: "Sign-in refused: account is disabled",
      });
      throw invalid();
    }

    if (account.locked_until && account.locked_until > new Date()) {
      await equaliseTiming();
      throw errors.unauthenticated(
        "Too many failed sign-in attempts. Try again in a few minutes.",
      );
    }

    if (!(await verifyPassword(credentials.password, account.password_hash))) {
      // Locks on the attempt that reaches the threshold. Counting from the
      // stored value means concurrent attempts can only overcount.
      await execute(
        `UPDATE users
            SET failed_login_attempts = failed_login_attempts + 1,
                locked_until = CASE
                  WHEN failed_login_attempts + 1 >= $2
                  THEN NOW() + ($3 || ' minutes')::INTERVAL
                  ELSE locked_until
                END,
                status = CASE
                  WHEN failed_login_attempts + 1 >= $2 AND status = 'ACTIVE'
                  THEN 'LOCKED'::user_status
                  ELSE status
                END
          WHERE id = $1`,
        [account.id, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MINUTES)],
      );

      await recordSecurityEvent(account.organization_id, {
        actorUserId: account.id,
        action: "LOGIN_FAILURE",
        summary: `Failed sign-in attempt ${account.failed_login_attempts + 1} of ${MAX_FAILED_ATTEMPTS}`,
      });

      throw invalid();
    }

    // Correct password on a locked-but-expired lock: clearing the counters and
    // returning the account to ACTIVE is what makes the lock temporary.
    await execute(
      `UPDATE users
          SET failed_login_attempts = 0,
              locked_until = NULL,
              last_login_at = NOW(),
              status = CASE WHEN status = 'LOCKED' THEN 'ACTIVE'::user_status ELSE status END
        WHERE id = $1`,
      [account.id],
    );

    // Upgrade the stored verifier when the cost parameters have moved on. This
    // is the only moment the plaintext is available to do it.
    if (needsRehash(account.password_hash)) {
      await execute(`UPDATE users SET password_hash = $2, password_updated_at = NOW() WHERE id = $1`, [
        account.id,
        await hashPassword(credentials.password),
      ]);
    }

    const { token } = await createSession(account.id, context);

    const row = await findSession(token);
    if (!row) throw errors.internal("Session was created but could not be read back.");

    await recordSecurityEvent(account.organization_id, {
      actorUserId: account.id,
      action: "LOGIN",
      summary: "Signed in with email and password",
    });

    return { session: toSession(row, await loadOverrides(row.organization_id, row.role)), token };
  },

  async signOut() {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;

    if (token) {
      const row = await findSession(token);
      await revokeSession(token, "signed out");

      if (row) {
        await recordSecurityEvent(row.organization_id, {
          actorUserId: row.user_id,
          action: "LOGOUT",
          summary: "Signed out",
        });
      }
    }

    store.delete(SESSION_COOKIE);
  },
};

/**
 * Set a user's password.
 *
 * Used by the bootstrap command and by the change-password flow. Revoking the
 * user's other sessions is the caller's decision, because "change my password"
 * and "an administrator reset my password" want different answers.
 */
export async function setPassword(userId: string, plaintext: string): Promise<void> {
  await execute(
    `UPDATE users
        SET password_hash = $2,
            password_updated_at = NOW(),
            failed_login_attempts = 0,
            locked_until = NULL,
            provider = 'PASSWORD',
            status = CASE WHEN status IN ('INVITED', 'LOCKED') THEN 'ACTIVE'::user_status ELSE status END
      WHERE id = $1`,
    [userId, await hashPassword(plaintext)],
  );
}

/** Disable an account and end every session it holds, in that order. */
export async function disableAccount(userId: string, organizationId: string): Promise<void> {
  await execute(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [userId]);
  const revoked = await revokeAllSessions(userId, "account disabled");

  await recordSecurityEvent(organizationId, {
    actorUserId: userId,
    action: "ACCOUNT_DISABLED",
    summary: `Account disabled; ${revoked} active session${revoked === 1 ? "" : "s"} revoked`,
  });
}
