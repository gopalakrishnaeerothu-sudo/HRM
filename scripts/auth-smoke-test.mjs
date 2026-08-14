/**
 * Authentication and authorization smoke test.
 *
 * Drives the REAL login flow over HTTP against a running server: anonymous
 * access, credential rejection, successful sign-in, session cookie hygiene,
 * role boundaries, session revocation on logout.
 *
 * Run against a server started with DEV_AUTH_ENABLED=false, so the production
 * adapter is what answers:
 *
 *   DEV_AUTH_ENABLED=false npx next dev -p 3300
 *   SMOKE_BASE_URL=http://localhost:3300 node scripts/auth-smoke-test.mjs
 */

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3300";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "taskflow-dev-2026";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "[32mPASS[0m" : "[31mFAIL[0m"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** A cookie jar per identity, so sessions do not bleed between checks. */
function makeJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    capture(response) {
      for (const cookie of response.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      }
    },
    raw: () => [...jar.entries()],
    get: (name) => jar.get(name),
  };
}

async function req(path, { jar, ...init } = {}) {
  const response = await fetch(BASE + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(jar ? { cookie: jar.header() } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  jar?.capture(response);
  return response;
}

async function login(email, password, jar) {
  return req("/api/auth/login", {
    jar,
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// --- 1. Anonymous access is refused ----------------------------------------

for (const path of ["/app", "/app/employees", "/app/settings", "/app/reports"]) {
  const response = await req(path);
  const location = response.headers.get("location") ?? "";
  check(
    `anonymous GET ${path} → redirected to login`,
    (response.status === 307 || response.status === 302) && location.includes("/login"),
    `${response.status} → ${location.split("?")[0] || "(none)"}`,
  );
}

{
  const response = await req("/api/employees");
  check("anonymous GET /api/employees → 401", response.status === 401, String(response.status));
}

{
  const response = await req("/api/dev/session");
  // Dev auth must be unreachable when DEV_AUTH_ENABLED=false.
  check("dev-auth route unreachable → 404", response.status === 404, String(response.status));
}

// --- 2. Credential rejection ------------------------------------------------

{
  const jar = makeJar();
  const response = await login("aarav.mehta@acmetech.example", "definitely-not-the-password", jar);
  const body = await response.json();
  check("wrong password → 401", response.status === 401, body?.error?.message ?? "");
  check("no session cookie issued on failure", jar.raw().length === 0, `${jar.raw().length} cookies`);
}

{
  const response = await login("nobody@nowhere.example", "some-password-here", makeJar());
  const body = await response.json();
  // Must be indistinguishable from a wrong password, or the endpoint becomes
  // an account-enumeration oracle.
  check(
    "unknown email gives the same 401 and message",
    response.status === 401 && /email or password/i.test(body?.error?.message ?? ""),
    body?.error?.message ?? "",
  );
}

// --- 3. Successful sign-in --------------------------------------------------

const ownerJar = makeJar();
{
  const response = await login("aarav.mehta@acmetech.example", PASSWORD, ownerJar);
  const body = await response.json();
  check("valid credentials → 200", response.ok, body?.data?.user?.name ?? body?.error?.message ?? "");
  check("session cookie issued", Boolean(ownerJar.get("tfhr_session")), "tfhr_session");
}

{
  const response = await req("/app", { jar: ownerJar });
  check("authenticated GET /app → 200", response.status === 200, String(response.status));
}

{
  const response = await req("/api/employees?page=1&pageSize=5", { jar: ownerJar });
  const body = await response.json();
  check("authenticated API call succeeds", response.ok && body.data.total > 0, `${body.data?.total} employees`);
}

// --- 4. Cookie hygiene ------------------------------------------------------

{
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: "aarav.mehta@acmetech.example", password: PASSWORD }),
  });
  const setCookie = (response.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("tfhr_session="));

  check("session cookie is HttpOnly", /HttpOnly/i.test(setCookie ?? ""), "");
  check("session cookie is SameSite=Lax", /SameSite=Lax/i.test(setCookie ?? ""), "");
  check("session cookie is Path=/", /Path=\//i.test(setCookie ?? ""), "");
  check("session cookie has an expiry", /Expires=/i.test(setCookie ?? ""), "");

  // The raw token must never appear in the response body.
  const body = await response.text();
  const token = (setCookie ?? "").split("=")[1]?.split(";")[0] ?? "__none__";
  check("token is not echoed in the response body", !body.includes(token), "");
}

// --- 5. Role boundaries (real sessions, not impersonation) ------------------

const employeeJar = makeJar();
{
  const response = await login("sneha.patel@acmetech.example", PASSWORD, employeeJar);
  check("employee signs in", response.ok, String(response.status));
}

{
  const response = await req("/api/employees", {
    jar: employeeJar,
    method: "POST",
    body: JSON.stringify({
      employeeCode: "HACK-1",
      firstName: "Nope",
      lastName: "Nope",
      email: "nope@example.com",
      designation: "Intruder",
      joinedAt: "2026-01-01",
    }),
  });
  check("employee cannot create employees → 403", response.status === 403, String(response.status));
}

{
  const response = await req("/api/settings", {
    jar: employeeJar,
    method: "PATCH",
    body: JSON.stringify({
      section: "attendancePolicy",
      values: {
        maxAccuracyMeters: 5000,
        maxTravelSpeedKmh: 2000,
        enforceGeofence: false,
        allowManualOverride: true,
        requireCheckoutLocation: false,
      },
    }),
  });
  check("employee cannot disable the geofence → 403", response.status === 403, String(response.status));
}

{
  const response = await req("/api/attendance/override", {
    jar: employeeJar,
    method: "POST",
    body: JSON.stringify({
      employeeId: "00000000-0000-0000-0000-000000000000",
      date: "2026-08-01",
      status: "PRESENT",
      reason: "Trying to forge attendance for myself",
    }),
  });
  check("employee cannot override attendance → 403", response.status === 403, String(response.status));
}

{
  /**
   * The audit log must reach no unauthorised eyes.
   *
   * Asserted on CONTENT, not status. `requirePagePermission` redirects before
   * any query runs, but the `/app` layout is `force-dynamic`, so Next has
   * already streamed the shell and committed HTTP 200 by the time the page
   * body redirects. The browser follows the redirect from the streamed
   * payload; the status line is a framework artifact.
   *
   * What matters is that not one audit row crosses the wire — which is what
   * this checks, against a real employee session.
   */
  const response = await req("/app/settings/audit", { jar: employeeJar });
  const body = await response.text();

  const leaksAuditData = /GEOFENCE_CHANGE|Changed Hyderabad|attendance policy|entityType/.test(body);
  const redirected = /NEXT_REDIRECT|\/app\?denied/.test(body);

  check("employee receives no audit data", !leaksAuditData, redirected ? "redirected away" : "");
  check("employee is redirected off the audit page", redirected, "");
}

// --- 6. Session revocation on logout ---------------------------------------

{
  const before = await req("/api/employees?page=1&pageSize=1", { jar: ownerJar });
  check("session works before logout", before.ok, String(before.status));

  const logout = await req("/api/auth/logout", { jar: ownerJar, method: "POST" });
  check("logout → 200", logout.ok, String(logout.status));

  const after = await req("/api/employees?page=1&pageSize=1", { jar: ownerJar });
  // The cookie may linger client-side; the SERVER must refuse it regardless.
  check("session refused after logout → 401", after.status === 401, String(after.status));
}

// --- 7. Forged and tampered tokens -----------------------------------------

{
  const response = await fetch(`${BASE}/api/employees`, {
    headers: { cookie: "tfhr_session=a-token-that-was-never-issued-0000000000" },
    redirect: "manual",
  });
  check("forged session token → 401", response.status === 401, String(response.status));
}

// --- 8. Rate limiting on login ---------------------------------------------

{
  let sawRateLimit = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await login("ratelimit.probe@acmetech.example", `wrong-${attempt}`, makeJar());
    if (response.status === 429) {
      sawRateLimit = true;
      break;
    }
  }
  check("repeated failures are rate limited → 429", sawRateLimit, "within 8 attempts");
}

// --- Summary ----------------------------------------------------------------

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
  console.log("\nFailures:");
  for (const failure of failed) console.log(`  · ${failure.name} ${failure.detail}`);
  process.exitCode = 1;
}
