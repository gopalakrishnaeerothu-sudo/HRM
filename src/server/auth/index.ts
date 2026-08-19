import "server-only";

import { cache } from "react";

import { errors } from "@/lib/errors";
import { isProduction, serverEnv } from "@/lib/env";
import { hasPermission, PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { devAuthAdapter } from "@/server/auth/dev-adapter";
import { productionAuthAdapter } from "@/server/auth/production-adapter";
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
 * Which adapter answers this request.
 *
 * Email and password is the real implementation and is what every deployment
 * uses, including local development. The impersonation adapter is an extra
 * that development may switch on; it is not a fallback, and production cannot
 * reach it — the `isProduction` half of that condition is not settable from
 * configuration, so leaving DEV_AUTH_ENABLED=true in a production environment
 * changes nothing.
 *
 * There is deliberately no "unconfigured" branch any more. It existed to fail
 * closed while no real provider was written; now that one is, a deployment
 * that cannot authenticate is a bug to surface, not a state to model.
 */
function resolveAdapter(): AuthAdapter {
  if (!isProduction && serverEnv().DEV_AUTH_ENABLED) {
    return devAuthAdapter;
  }
  return productionAuthAdapter;
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

/**
 * The authenticated context, with permissions already resolved.
 *
 * `getSession` returns the principal and the tenant's permission *overrides*;
 * turning those into the actual granted set means folding in the role
 * defaults, which several call sites were each doing for themselves. Doing it
 * once here means a page and its navigation cannot disagree about what the
 * user may do.
 *
 * Cached alongside `getSession`, so this costs no extra round-trip.
 */
export const getCurrentUser = cache(async (): Promise<AuthContext | null> => {
  const session = await getSession();
  if (!session) return null;

  return {
    ...session,
    permissions: PERMISSIONS.filter((permission) =>
      hasPermission(session.user.role, permission, session.permissionOverrides),
    ),
  };
});

/** The authenticated context or 401. */
export async function requireCurrentUser(): Promise<AuthContext> {
  const context = await getCurrentUser();
  if (!context) throw errors.unauthenticated();
  return context;
}

export interface AuthContext extends AuthSession {
  /** Every permission this user actually holds, role defaults plus overrides. */
  permissions: Permission[];
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
