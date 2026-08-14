import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { errors } from "@/lib/errors";
import { isProduction, serverEnv } from "@/lib/env";
import { hasPermission, type Permission } from "@/server/auth/permissions";
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
 * Adapter selection.
 *
 * The production adapter — email/password with server-side sessions — is the
 * default and the only thing that ever runs in production. The development
 * impersonation adapter is reachable *only* when both conditions hold:
 *
 *   NODE_ENV !== "production"   AND   DEV_AUTH_ENABLED === "true"
 *
 * `isProduction` is evaluated first and short-circuits, so a production
 * deployment that forgets to unset the flag still gets the real adapter. The
 * dev adapter additionally re-asserts both conditions internally, and the
 * /api/dev/* routes assert them a third time — three independent fences on the
 * same door, because the cost of that door being open is total.
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

/**
 * Page-level authorisation gate.
 *
 * `requirePermission` raises an `AppError`, which a route handler turns into a
 * 403 — correct for an API. In a Server Component that same throw is caught by
 * the nearest `error.tsx` and rendered as a generic error page, which is both
 * the wrong status and an unhelpful dead end.
 *
 * This redirects instead:
 *   · no session      → /login, preserving nothing (the layout handles `next`)
 *   · wrong role      → /app?denied=<permission>, so the user lands somewhere
 *                       useful and the dashboard can explain what happened
 *
 * A redirect is issued before any page data is fetched, so nothing the caller
 * is not entitled to is ever queried, let alone rendered.
 *
 * Note on `notFound()`: it was tried here first, to match the 404-not-403
 * convention the repositories use. Under a `force-dynamic` layout Next has
 * already committed a 200 by the time the page body throws, so the response
 * carried the not-found *content* with a 200 *status*. No data leaked — the
 * check still runs before any query — but the status was misleading, and a
 * redirect avoids the ambiguity entirely.
 */
export async function requirePagePermission(permission: Permission): Promise<AuthSession> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (!hasPermission(session.user.role, permission, session.permissionOverrides)) {
    redirect(`/app?denied=${encodeURIComponent(permission)}`);
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
