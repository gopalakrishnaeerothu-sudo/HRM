import { NextResponse } from "next/server";

import { errors, toPublicError } from "@/lib/errors";
import { signUpSchema } from "@/lib/validation/auth";
import { assertSameOrigin } from "@/server/http/origin";
import { signUp } from "@/server/services/user-access-service";

/**
 * Request access to an organisation.
 *
 * Shaped like the sign-in handler next door rather than going through
 * `route()`, for the same reason: `route()` resolves a session and applies a
 * permission, and this endpoint has neither. What it keeps from that pipeline
 * is the part that still applies without a caller — the cross-origin check.
 * Rate limiting lives in the service, because the limit has to cover the
 * Argon2 hash it performs.
 *
 * ─── No session is issued ───────────────────────────────────────────────────
 * Signing up does not sign you in. The account is created PENDING, and the
 * response deliberately carries no cookie: the entire point of the queue is
 * that an administrator decides before this person has access, so handing back
 * a session here — even a limited one — would be the bug the feature exists to
 * prevent.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await assertSameOrigin();

    const parsed = signUpSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw errors.validation(
        "Please check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await signUp(parsed.data);

    return NextResponse.json(
      {
        data: {
          status: result.status,
          organizationName: result.organizationName,
          message: "Your request has been sent to your administrator for approval.",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const { status, body } = toPublicError(error);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
