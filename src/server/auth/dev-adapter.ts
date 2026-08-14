import "server-only";

import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
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
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      role: true,
      organization: { select: { id: true, slug: true, name: true, timezone: true, deletedAt: true } },
      employee: {
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          designation: true,
          avatarUrl: true,
          departmentId: true,
          managerId: true,
          primaryOfficeId: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!user || user.organization.deletedAt) return null;

  const overrideRows = await prisma.rolePermission.findMany({
    where: { organizationId: user.organization.id, role: user.role },
    select: { granted: true, permission: { select: { key: true } } },
  });

  const permissionOverrides = new Map<Permission, boolean>(
    overrideRows.map((row) => [row.permission.key as Permission, row.granted]),
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
    },
    organization: {
      id: user.organization.id,
      slug: user.organization.slug,
      name: user.organization.name,
      timezone: user.organization.timezone,
    },
    employee:
      user.employee && !user.employee.deletedAt
        ? {
            id: user.employee.id,
            employeeCode: user.employee.employeeCode,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            designation: user.employee.designation,
            avatarUrl: user.employee.avatarUrl,
            departmentId: user.employee.departmentId,
            managerId: user.employee.managerId,
            primaryOfficeId: user.employee.primaryOfficeId,
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

    const fallbackUser = await prisma.user.findFirst({
      where: { email: fallbackEmail, deletedAt: null },
      select: { id: true },
    });
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
