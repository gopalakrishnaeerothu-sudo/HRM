import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { clientEnv } from "@/lib/env";
import { errors, toPublicError } from "@/lib/errors";
import { fieldErrors } from "@/lib/validation/common";
import type { Permission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth";
import type { AuthSession } from "@/server/auth/types";
import { consume, RATE_LIMITS, rateLimitKey } from "@/server/services/rate-limit";

/**
 * Route-handler plumbing.
 *
 * Every mutation in the product goes through `route()`, which applies, in
 * order: origin check → authentication → authorisation → rate limit → schema
 * validation → handler → error mapping. Doing it here rather than per route is
 * what makes "every mutation is checked" a structural property instead of a
 * convention someone has to remember.
 */

export interface RouteContext<TBody, TParams> {
  request: NextRequest;
  session: AuthSession;
  body: TBody;
  params: TParams;
}

interface RouteOptions<TSchema extends z.ZodTypeAny | undefined, TParams> {
  /** Omit for public endpoints (only the health check today). */
  auth?: false;
  /** Server-side authorisation gate. */
  permission?: Permission;
  /** Body schema. Mutations without one are rejected at build time by types. */
  schema?: TSchema;
  /** Rate-limit bucket. Defaults to `mutation` for writes, `read` otherwise. */
  limit?: keyof typeof RATE_LIMITS;
  handler: (
    context: RouteContext<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined, TParams>,
  ) => Promise<unknown>;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Reject cross-origin state changes.
 *
 * Session cookies are SameSite=Lax, which already blocks the classic CSRF
 * shapes; this is the belt to that pair of braces, and it costs one header
 * comparison.
 */
function assertSameOrigin(request: NextRequest): void {
  if (!MUTATING_METHODS.has(request.method)) return;

  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin fetches from some clients omit it

  const allowed = new Set<string>([clientEnv.NEXT_PUBLIC_APP_URL, request.nextUrl.origin]);
  if (!allowed.has(origin)) {
    throw errors.forbidden("Cross-origin request rejected.");
  }
}

async function readBody(request: NextRequest): Promise<unknown> {
  if (!MUTATING_METHODS.has(request.method)) return undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    return await request.json();
  } catch {
    throw errors.validation("The request body wasn't valid JSON.");
  }
}

/**
 * Wrap a route handler.
 *
 * Next 15 passes route params as a Promise, so `params` is awaited here and
 * handed to the handler already resolved.
 */
export function route<TParams extends Record<string, string> = Record<string, never>, TSchema extends z.ZodTypeAny | undefined = undefined>(
  options: RouteOptions<TSchema, TParams>,
) {
  // Next 15 always supplies the segment context — including for routes with no
  // dynamic params, where `params` resolves to `{}` — so it is required here to
  // satisfy the generated `RouteContext` constraint.
  return async (
    request: NextRequest,
    segmentData: { params: Promise<TParams> },
  ): Promise<NextResponse> => {
    try {
      assertSameOrigin(request);

      const params = ((await segmentData?.params) ?? {}) as TParams;

      let session: AuthSession | null = null;
      if (options.auth !== false) {
        session = await requireSession();

        if (options.permission) {
          const { hasPermission } = await import("@/server/auth/permissions");
          if (!hasPermission(session.user.role, options.permission, session.permissionOverrides)) {
            throw errors.forbidden();
          }
        }
      }

      const bucket =
        options.limit ?? (MUTATING_METHODS.has(request.method) ? "mutation" : "read");
      const limitConfig = RATE_LIMITS[bucket];
      const limitKey = rateLimitKey(
        bucket,
        session?.organization.id,
        session?.user.id ?? request.headers.get("x-forwarded-for") ?? "anonymous",
      );
      const limitResult = consume(limitKey, limitConfig.limit, limitConfig.windowSeconds);
      if (!limitResult.allowed) throw errors.rateLimited(limitResult.retryAfterSeconds);

      let body: unknown = undefined;
      if (options.schema) {
        const raw = await readBody(request);
        const parsed = options.schema.safeParse(raw);
        if (!parsed.success) {
          throw errors.validation("Please check the highlighted fields.", fieldErrors(parsed.error));
        }
        body = parsed.data;
      }

      const result = await options.handler({
        request,
        session: session as AuthSession,
        body: body as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined,
        params,
      });

      // A handler may return a Response itself — a CSV download, a redirect —
      // in which case it is passed straight through. `NextResponse` extends
      // `Response`, so testing the base class covers both; testing only
      // `NextResponse` would silently JSON-wrap a file download.
      if (result instanceof Response) return result as NextResponse;

      return NextResponse.json({ data: result ?? null }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const { status, body } = toPublicError(error);
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
  };
}

/** Parse and validate `?a=1&b=2` against a schema. */
export function parseQuery<TSchema extends z.ZodTypeAny>(
  request: NextRequest,
  schema: TSchema,
): z.infer<TSchema> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    // Repeated keys become arrays (e.g. ?status=TODO&status=BLOCKED).
    const existing = raw[key];
    if (existing === undefined) raw[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else raw[key] = [existing, value];
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw errors.validation("Some filters weren't valid.", fieldErrors(parsed.error));
  }
  return parsed.data;
}

/** Client metadata for audit and attendance events. */
export function clientMeta(request: NextRequest) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  };
}
