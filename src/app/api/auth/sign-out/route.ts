import { NextResponse } from "next/server";

import { toPublicError } from "@/lib/errors";
import { authAdapter } from "@/server/auth";

/**
 * Sign out.
 *
 * POST rather than GET, so a link or an image tag on another site cannot end
 * someone's session by being loaded.
 */

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Revokes the row server-side and clears the cookie. Signing out with an
    // already-invalid cookie is not an error — the caller wanted to be signed
    // out, and they are.
    await authAdapter.current.signOut();

    return NextResponse.json({ data: { signedOut: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
