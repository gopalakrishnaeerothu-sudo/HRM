import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isProduction } from "@/lib/env";
import { errors, toPublicError } from "@/lib/errors";
import { authAdapter } from "@/server/auth";
import { SESSION_COOKIE } from "@/server/auth/types";

/**
 * Email and password sign-in.
 *
 * The adapter does the authenticating; this handler's job is the cookie. It is
 * the only place the session token is ever written, and it is written
 * `httpOnly` so no script can read it — an XSS bug then cannot walk away with
 * a session.
 */

export const dynamic = "force-dynamic";

const signInSchema = z.object({
  email: z.string().min(1, "Enter your email address.").email("That doesn't look like an email address."),
  // Deliberately no complexity rules on the way *in*: the stored password was
  // whatever it was, and rejecting it here would lock out a valid account.
  password: z.string().min(1, "Enter your password."),
});

export async function POST(request: Request) {
  try {
    const parsed = signInSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw errors.validation("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }

    const { session, token } = await authAdapter.current.signIn({
      kind: "password",
      email: parsed.data.email,
      password: parsed.data.password,
    });

    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      // Render terminates TLS in front of the app, so production is always
      // https. Local development is http://localhost, where `secure` would
      // stop the cookie being stored at all.
      secure: isProduction,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

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
