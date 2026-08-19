import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/server/auth/types";

/**
 * First gate on `/app`.
 *
 * ─── What this is, and what it is not ───────────────────────────────────────
 * Middleware runs on the Edge runtime and cannot open a PostgreSQL
 * connection, so it can only see *whether a cookie is present* — not whether
 * the session behind it is live, expired, revoked, or belongs to a disabled
 * account. It is therefore NOT the authorisation boundary.
 *
 * The real check is `getSession()` in the /app layout, which resolves the
 * session against the database on every request. This exists for one thing
 * that layout cannot do well: it knows the requested path, so it can send an
 * unauthenticated visitor to `/login?next=/app/tasks` and put them back where
 * they were aiming after they sign in.
 *
 * Treating a present-but-invalid cookie as "maybe signed in" is safe precisely
 * because the layout re-checks and redirects anyway.
 */
export function middleware(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  if (hasSessionCookie) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);

  // Path and query only — never the full URL. Passing an absolute URL through
  // would make `?next=` an open-redirect vector; the login page validates this
  // again on the way out, so both ends agree it is a local path.
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (target !== "/app") loginUrl.searchParams.set("next", target);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * `/app` and everything beneath it. The marketing pages, `/login` itself and
   * `/api/*` are deliberately excluded: API routes answer with 401 JSON rather
   * than an HTML redirect, which is what a fetch caller can actually use.
   */
  matcher: ["/app", "/app/:path*"],
};
