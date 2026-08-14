import { NextResponse, type NextRequest } from "next/server";

import { clientEnv } from "@/lib/env";
import { toPublicError } from "@/lib/errors";
import { authAdapter, getSession } from "@/server/auth";

/**
 * POST /api/auth/logout
 *
 * Revokes the session server-side and clears the cookie. Both matter: clearing
 * only the cookie would leave a live session row that a copied token could
 * still use.
 *
 * Always returns 200, even with no session. Sign-out is idempotent, and an
 * error here would only ever strand someone on a page they want to leave.
 */
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin) {
      const allowed = new Set([clientEnv.NEXT_PUBLIC_APP_URL, request.nextUrl.origin]);
      if (!allowed.has(origin)) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Cross-origin request rejected." } },
          { status: 403 },
        );
      }
    }

    const session = await getSession();
    await authAdapter.current.signOut();

    if (session) {
      console.info("[auth] sign-out", {
        userId: session.user.id,
        organizationId: session.organization.id,
      });
    }

    return NextResponse.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
