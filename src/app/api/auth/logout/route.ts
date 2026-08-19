import { NextResponse } from "next/server";

import { toPublicError } from "@/lib/errors";
import { authAdapter } from "@/server/auth";
import { assertSameOrigin } from "@/server/http/origin";

/**
 * Sign out: revoke the session server-side, then clear the cookie.
 *
 * POST rather than GET, so a link or an <img> on another site cannot end
 * someone's session by being loaded. Signing out with an already-invalid
 * cookie is not an error — the caller wanted to be signed out, and they are.
 */

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await assertSameOrigin();
    await authAdapter.current.signOut();

    return NextResponse.json(
      { data: { signedOut: true } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
