import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isProduction } from "@/lib/env";
import { errors, toPublicError } from "@/lib/errors";
import { signInSchema } from "@/lib/validation/auth";
import { authAdapter } from "@/server/auth";
import { SESSION_COOKIE } from "@/server/auth/types";
import { assertSameOrigin } from "@/server/http/origin";

/**
 * Sign in with email and password.
 *
 * The adapter does the authenticating — rate limiting, account status,
 * Argon2id verification, lockout accounting and the audit entry all live
 * there. This handler's job is the two things that are HTTP's concern:
 * refusing a cross-origin submission, and writing the cookie.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await assertSameOrigin();

    const parsed = signInSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw errors.validation(
        "Please check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const { session, token } = await authAdapter.current.signIn({
      kind: "password",
      email: parsed.data.email,
      password: parsed.data.password,
    });

    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
      // No script can read it, so an XSS bug cannot walk away with a session.
      httpOnly: true,
      // Lax rather than Strict: Strict would drop the cookie when arriving
      // from an external link, logging people out on every inbound click.
      sameSite: "lax",
      // Render terminates TLS in front of the app, so production is always
      // https. Local development is http://localhost, where `secure` would
      // stop the cookie being stored at all.
      secure: isProduction,
      path: "/",
      // Matches SESSION_TTL_DAYS. The database expiry is authoritative — this
      // only stops the browser sending a cookie already known to be dead.
      maxAge: 60 * 60 * 24 * 14,
    });

    // Deliberately minimal. The client needs to know who signed in; everything
    // else it needs it will fetch as an authenticated user.
    return NextResponse.json(
      {
        data: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
