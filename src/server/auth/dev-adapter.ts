import "server-only";

import { cookies } from "next/headers";

import { query, queryOne } from "@/server/db/query";
import { serverEnv, isProduction } from "@/lib/env";
import { errors } from "@/lib/errors";
import type { Permission } from "@/server/auth/permissions";
import { SESSION_COOKIE, type AuthAdapter, type AuthSession, type SignInCredentials } from "@/server/auth/types";

/**
 * DEVELOPMENT-ONLY authentication.
 *
 * ─── What this is ────────────────────────────────────────────────────────────
 * A way to *view* the application as any seeded user while real authentication
 * is not yet wired up. It performs no authentication whatsoever: the cookie
 * holds a user id, and that user is loaded. Anyone who can set a cookie can
 * become anyone.
 *
 * ─── Why it is safe to ship ──────────────────────────────────────────────────
 * It is refused twice over: `assertDevAuthAllowed` throws when NODE_ENV is
 * production, and again when DEV_AUTH_ENABLED is not "true". Both must pass.
 * A production deployment that forgets to unset the flag still gets a hard
 * failure rather than an open door.
 *
 * ─── Replacing it ───────────────────────────────────────────────────────────
 * Write another `AuthAdapter` (password, OTP, Google, Microsoft, SSO), register
 * it in `./index.ts`, and delete nothing else — no call site outside this
 * folder knows which adapter is in use. The `sessions` table already stores
 * hashed tokens, expiry, IP and user agent for a real implementation to use.
 */

function assertDevAuthAllowed(): void {
  if (isProduction) {
    throw new Error(
      "Development authentication was invoked in production. Configure a real AuthAdapter in src/server/auth/index.ts.",
    );
  }
  if (!serverEnv().DEV_AUTH_ENABLED) {
    throw errors.unauthenticated("Development sign-in is disabled. Set DEV_AUTH_ENABLED=true locally.");
  }
}

/** Shape shared by `getSession` and `signIn`. */
async function loadSession(userId: string): Promise<AuthSession | null> {
  // The employee join excludes soft-deleted rows here rather than filtering
  // afterwards, so a departed employee yields a session with no employee
  // profile instead of one carrying a dead id.
  const user = await queryOne<{
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    role: UserRole;
    org_id: string;
    org_slug: string;
    org_name: string;
    org_timezone: string;
    emp_id: string | null;
    emp_code: string | null;
    emp_first_name: string | null;
    emp_last_name: string | null;
    emp_designation: string | null;
    emp_avatar_url: string | null;
    emp_department_id: string | null;
    emp_manager_id: string | null;
    emp_primary_office_id: string | null;
  }>(
    `SELECT u.id, u.email, u.name, u.avatar_url, u.role,
            o.id AS org_id, o.slug AS org_slug, o.name AS org_name,
            o.timezone AS org_timezone,
            e.id AS emp_id, e.employee_code AS emp_code,
            e.first_name AS emp_first_name, e.last_name AS emp_last_name,
            e.designation AS emp_designation, e.avatar_url AS emp_avatar_url,
            e.department_id AS emp_department_id, e.manager_id AS emp_manager_id,
            e.primary_office_id AS emp_primary_office_id
       FROM users u
       JOIN organizations o ON o.id = u.organization_id AND o.deleted_at IS NULL
       LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
      WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'ACTIVE'`,
    [userId],
  );

  if (!user) return null;

  const overrideRows = await query<{ key: string; granted: boolean }>(
    `SELECT p.key, rp.granted
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.organization_id = $1 AND rp.role = $2::user_role`,
    [user.org_id, user.role],
  );

  const permissionOverrides = new Map<Permission, boolean>(
    overrideRows.map((row) => [row.key as Permission, row.granted]),
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      role: user.role,
    },
    organization: {
      id: user.org_id,
      slug: user.org_slug,
      name: user.org_name,
      timezone: user.org_timezone,
    },
    employee: user.emp_id
      ? {
          id: user.emp_id,
          employeeCode: user.emp_code!,
          firstName: user.emp_first_name!,
          lastName: user.emp_last_name!,
          designation: user.emp_designation!,
          avatarUrl: user.emp_avatar_url,
          departmentId: user.emp_department_id,
          managerId: user.emp_manager_id,
          primaryOfficeId: user.emp_primary_office_id,
        }
      : null,
    permissionOverrides,
    strategy: "dev-impersonation",
  };
}

export const devAuthAdapter: AuthAdapter = {
  name: "development-impersonation",
  strategy: "dev-impersonation",

  async getSession() {
    assertDevAuthAllowed();

    const store = await cookies();
    const cookieUserId = store.get(SESSION_COOKIE)?.value;

    if (cookieUserId) {
      const session = await loadSession(cookieUserId);
      if (session) return session;
      // Stale cookie (database reseeded) — fall through to the default user.
    }

    // Convenience for a fresh clone: land on a seeded account rather than a
    // sign-in wall that does not exist yet.
    const fallbackEmail = serverEnv().DEV_AUTH_DEFAULT_USER;
    if (!fallbackEmail) return null;

    const fallbackUser = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [fallbackEmail],
    );
    if (!fallbackUser) return null;

    return loadSession(fallbackUser.id);
  },

  async signIn(credentials: SignInCredentials) {
    assertDevAuthAllowed();

    if (credentials.kind !== "dev-impersonation") {
      throw errors.precondition(
        `The development adapter cannot handle "${credentials.kind}" sign-in. Register a production AuthAdapter first.`,
      );
    }

    const session = await loadSession(credentials.userId);
    if (!session) throw errors.notFound("user");

    return { session, token: credentials.userId };
  },

  async signOut() {
    assertDevAuthAllowed();
    const store = await cookies();
    store.delete(SESSION_COOKIE);
  },
};
