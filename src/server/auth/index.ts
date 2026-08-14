import "server-only";

import { cache } from "react";

import { errors } from "@/lib/errors";
import { isProduction, serverEnv } from "@/lib/env";
import { hasPermission, type Permission } from "@/server/auth/permissions";
import { devAuthAdapter } from "@/server/auth/dev-adapter";
import type { AuthAdapter, AuthSession } from "@/server/auth/types";

/**
 * The authentication boundary.
 *
 * Everything above this line in the stack — pages, route handlers, services —
 * calls `getSession()` / `requireSession()` / `requirePermission()` and never
 * touches an adapter directly. Swapping in real authentication means changing
 * only `resolveAdapter()` below.
 */

/**
 * Placeholder for the production adapter. It deliberately throws rather than
 * falling back to something permissive: an unconfigured production deployment
 * must fail closed.
 *
 * To implement: verify the session cookie against the `sessions` table
 * (`tokenHash` = SHA-256 of the cookie value, `expiresAt` in the future,
 * `revokedAt` null), then build the same `AuthSession` shape the dev adapter
 * returns. See src/server/auth/README.md.
 */
const unconfiguredProductionAdapter: AuthAdapter = {
  name: "unconfigured",
  strategy: "session-cookie",
  async getSession() {
    return null;
  },
  async signIn() {
    throw errors.precondition(
      "No authentication provider is configured for this deployment. Register an AuthAdapter in src/server/auth/index.ts.",
    );
  },
  async signOut() {
    /* nothing to revoke */
  },
};

function resolveAdapter(): AuthAdapter {
  if (!isProduction && serverEnv().DEV_AUTH_ENABLED) {
    return devAuthAdapter;
  }
  return unconfiguredProductionAdapter;
}

export const authAdapter = { get current() { return resolveAdapter(); } };

/**
 * Current session, or null when signed out.
 *
 * `cache` deduplicates within a single server render, so a page and the ten
 * components beneath it share one database round-trip.
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  try {
    return await resolveAdapter().getSession();
  } catch (error) {
    // A misconfigured adapter must not crash a public page; treat as signed out.
    console.error("[auth] session resolution failed", error);
    return null;
  }
});

/** Session or 401. Use in every authenticated page and route handler. */
export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) throw errors.unauthenticated();
  return session;
}

/** Session whose user has an employee profile, or 403. */
export async function requireEmployeeSession(): Promise<
  AuthSession & { employee: NonNullable<AuthSession["employee"]> }
> {
  const session = await requireSession();
  if (!session.employee) {
    throw errors.forbidden("This account has no employee profile, so it cannot perform that action.");
  }
  return session as AuthSession & { employee: NonNullable<AuthSession["employee"]> };
}

/**
 * Authorisation gate. The role is read from the server-side session, never
 * from anything the client sent.
 */
export async function requirePermission(permission: Permission): Promise<AuthSession> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, permission, session.permissionOverrides)) {
    throw errors.forbidden();
  }
  return session;
}

/** Non-throwing check, for conditionally rendering UI. */
export function can(session: AuthSession | null, permission: Permission): boolean {
  if (!session) return false;
  return hasPermission(session.user.role, permission, session.permissionOverrides);
}

export type { AuthSession } from "@/server/auth/types";
export { SESSION_COOKIE } from "@/server/auth/types";
