import "server-only";

import { headers } from "next/headers";

import { errors } from "@/lib/errors";
import { isProduction } from "@/lib/env";

/**
 * Same-origin enforcement for state-changing requests.
 *
 * ─── What this defends against ──────────────────────────────────────────────
 * The session cookie is `SameSite=Lax`, which already stops a cross-site
 * *form* POST carrying it. This is the second layer: it rejects the request
 * even if that cookie policy is ever loosened, or if a browser's
 * interpretation of "same site" turns out to be more generous than expected —
 * a registrable-domain sibling is same-site but not same-origin.
 *
 * ─── Why the Origin header ──────────────────────────────────────────────────
 * Browsers set `Origin` on every POST and it cannot be forged by page script.
 * `Referer` is stripped by privacy tooling often enough to be unusable as a
 * gate. A request with no `Origin` at all is not a browser form post — curl,
 * a mobile client, a health probe — and is allowed through so that
 * non-browser clients keep working; those carry no ambient cookie, so they
 * cannot be the confused deputy this guards against.
 */

/**
 * The origins a mutation may come from.
 *
 * `APP_URL` is the deployment's own address. `NEXT_PUBLIC_APP_URL` is accepted
 * as a fallback because it already exists in this project and holds the same
 * value; it is a URL, not a secret, so its being public is not a leak.
 */
function allowedOrigins(): string[] {
  const configured = [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]
    .filter((value): value is string => Boolean(value))
    .map(normalise)
    .filter((value): value is string => value !== null);

  if (isProduction) return configured;

  // Local development moves between ports often enough that pinning one is a
  // constant nuisance; production is pinned to configuration.
  return [...configured, "http://localhost:3000", "http://127.0.0.1:3000"];
}

function normalise(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Reject a mutation that did not come from this application.
 *
 * Throws 403 rather than 400: the request was well-formed and understood, and
 * refused on authorisation grounds.
 */
export async function assertSameOrigin(): Promise<void> {
  const headerList = await headers();
  const origin = headerList.get("origin");

  // Not a browser-issued cross-origin request — see the note above.
  if (!origin) return;

  const allowed = allowedOrigins();

  // Same-origin by the request's own reckoning. `host` is what the browser
  // actually connected to, which is the honest comparison when a deployment
  // is reachable at more than one hostname.
  const host = headerList.get("host");
  if (host) {
    const scheme = isProduction ? "https" : "http";
    allowed.push(`${scheme}://${host}`);
  }

  if (!allowed.includes(origin)) {
    // Deliberately does not echo the rejected origin back to the caller; it
    // goes to the log, where an operator can see it.
    console.warn("[origin] rejected cross-origin mutation", { origin, host });
    throw errors.forbidden("This request did not come from the application.");
  }
}
