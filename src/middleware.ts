import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/server/auth/types";

/**
 * Edge middleware.
 *
 * Two jobs, and it is important to be precise about what this is *not*.
 *
 * 1. **Expose the request path** as `x-pathname`, so the `/app` layout can
 *    preserve where an anonymous visitor was heading and send them back there
 *    after signing in.
 *
 * 2. **A cheap first-pass redirect** for `/app/*` requests that carry no
 *    session cookie at all. This saves rendering a layout that would only
 *    redirect anyway.
 *
 * ─── What this is not ───────────────────────────────────────────────────────
 * This is NOT the authentication boundary. Middleware runs on the Edge
 * runtime, which has no database access, so it can only observe that a cookie
 * *exists* — never that it is valid, unexpired, unrevoked, or belongs to an
 * active user. A forged cookie sails straight through here.
 *
 * The real check is `getSession()` in `src/app/app/layout.tsx`, which resolves
 * the token against the `sessions` table and re-reads the user on every
 * request. Removing this middleware would cost a little latency and change no
 * security property whatsoever. Treating it as the guard would be the mistake.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);

  if (pathname.startsWith("/app")) {
    const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

    if (!hasSessionCookie) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  /**
   * Skip Next's internals and static assets. `/api` is deliberately excluded:
   * API routes return JSON 401s through the route wrapper, and redirecting an
   * XHR to an HTML login page would give callers an unparseable response.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
