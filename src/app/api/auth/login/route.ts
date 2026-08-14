import { NextResponse, type NextRequest } from "next/server";

import { clientEnv } from "@/lib/env";
import { errors, toPublicError } from "@/lib/errors";
import { fieldErrors } from "@/lib/validation/common";
import { loginSchema, safeRedirect } from "@/lib/validation/auth";
import { authAdapter } from "@/server/auth";
import { setSessionCookie } from "@/server/auth/session-store";
import { consume, rateLimitKey } from "@/server/services/rate-limit";

/**
 * POST /api/auth/login
 *
 * Deliberately NOT routed through `src/server/api/handler.ts`: that wrapper
 * calls `requireSession()`, and this is the endpoint you use when you have no
 * session. The checks it would have applied are done explicitly below.
 *
 * Rate limiting is two-dimensional on purpose:
 *   · per email  — stops one account being ground down
 *   · per IP     — stops one host spraying many accounts
 * Credential stuffing defeats either limit alone.
 */

const MUTATING_ORIGIN_ERROR = "Cross-origin request rejected.";

function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const allowed = new Set([clientEnv.NEXT_PUBLIC_APP_URL, request.nextUrl.origin]);
  if (!allowed.has(origin)) throw errors.forbidden(MUTATING_ORIGIN_ERROR);
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw errors.validation("The request body wasn't valid JSON.");
    }

    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) {
      throw errors.validation("Enter your email and password.", fieldErrors(parsed.error));
    }

    const { email, password, redirectTo } = parsed.data;
    const ip = clientIp(request);

    // Per-account: 5 attempts / 15 minutes. Matches the database lockout, so
    // the two do not disagree about when someone is locked out.
    const byAccount = consume(rateLimitKey("login:account", email), 5, 15 * 60);
    if (!byAccount.allowed) throw errors.rateLimited(byAccount.retryAfterSeconds);

    // Per-IP: 20 attempts / 15 minutes, covering spray across many accounts.
    const byIp = consume(rateLimitKey("login:ip", ip), 20, 15 * 60);
    if (!byIp.allowed) throw errors.rateLimited(byIp.retryAfterSeconds);

    const { session, token } = await authAdapter.current.signIn({
      kind: "password",
      email,
      password,
      context: { ipAddress: ip === "unknown" ? null : ip, userAgent: request.headers.get("user-agent") },
    });

    await setSessionCookie(token, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

    // Log the successful sign-in without the token or any credential.
    console.info("[auth] sign-in", {
      userId: session.user.id,
      organizationId: session.organization.id,
      role: session.user.role,
    });

    return NextResponse.json(
      {
        data: {
          redirectTo: safeRedirect(redirectTo),
          user: {
            name: session.user.name,
            role: session.user.role,
            organization: session.organization.name,
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const { status, body } = toPublicError(error);

    // Failures are logged with the reason code but never the attempted
    // password, and never whether the email exists.
    if (status === 401 || status === 403 || status === 429) {
      console.warn("[auth] sign-in refused", { code: body.error.code, ip: clientIp(request) });
    }

    return NextResponse.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 429 && typeof body.error.meta?.retryAfterSeconds === "number"
          ? { "Retry-After": String(body.error.meta.retryAfterSeconds) }
          : {}),
      },
    });
  }
}
