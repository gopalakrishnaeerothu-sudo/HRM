/**
 * End-to-end smoke test against a running server.
 *
 * Drives the real HTTP API with a real cookie jar: page renders, CRUD, the
 * geofence verdict for inside/outside/spoofed coordinates, permission
 * boundaries, and CSRF rejection.
 *
 *   npm run build && npx next start -p 3100
 *   node scripts/smoke-test.mjs
 *
 * Requires a seeded database and DEV_AUTH_ENABLED=true.
 */

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function capture(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

async function req(path, init = {}) {
  const response = await fetch(BASE + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      cookie: cookieHeader(),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  capture(response);
  return response;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "[32mPASS[0m" : "[31mFAIL[0m";
  console.log(`${mark}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// --- 1. Public surface ------------------------------------------------------
let response = await req("/");
check("GET / (landing page)", response.status === 200, String(response.status));

response = await req("/api/health");
const health = await response.json();
check("GET /api/health", response.ok && health.status === "ok", `db ${health.databaseLatencyMs}ms`);

// --- 2. Development session -------------------------------------------------
response = await req("/api/dev/session");
const users = (await response.json()).data;
check("GET /api/dev/session", response.ok && users.length > 0, `${users.length} seeded users`);

const owner = users.find((user) => user.role === "OWNER");
const employee = users.find((user) => user.role === "EMPLOYEE");

response = await req("/api/dev/session", {
  method: "POST",
  body: JSON.stringify({ userId: owner.id }),
});
check("POST /api/dev/session (as OWNER)", response.ok, owner.name);

// --- 3. Every authenticated page renders ------------------------------------
const pages = [
  "/app",
  "/app/employees",
  "/app/employees/new",
  "/app/tasks",
  "/app/tasks/new",
  "/app/attendance",
  "/app/attendance/my",
  "/app/locations",
  "/app/reports",
  "/app/teams",
  "/app/leave",
  "/app/notifications",
  "/app/settings",
  "/app/settings/audit",
  "/app/settings/profile",
];
for (const page of pages) {
  const res = await req(page);
  check(`GET ${page}`, res.status === 200, String(res.status));
}

// --- 4. Read endpoints ------------------------------------------------------
response = await req("/api/employees?page=1&pageSize=5");
let body = await response.json();
check("GET /api/employees", response.ok && body.data.total === 22, `total ${body.data?.total}`);

response = await req("/api/tasks?page=1&pageSize=50");
body = await response.json();
check("GET /api/tasks", response.ok && body.data.total >= 18, `total ${body.data?.total}`);

response = await req("/api/offices");
body = await response.json();
check("GET /api/offices", response.ok && body.data.length === 2, `${body.data?.length} offices`);

response = await req("/api/search?q=Priya");
body = await response.json();
check("GET /api/search", response.ok && body.data.employees.length > 0, `${body.data?.employees?.length} matches`);

// --- 5. CSV export ----------------------------------------------------------
response = await req("/api/reports/export?report=working-hours&days=30");
const csv = await response.text();
const csvLines = csv.split("\r\n");
check(
  "GET /api/reports/export (CSV)",
  response.ok && csvLines.length > 20 && csvLines[0].includes("Employee"),
  `${csvLines.length} lines`,
);

// --- 6. Task lifecycle ------------------------------------------------------
response = await req("/api/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "Smoke test task",
    description: "Created by scripts/smoke-test.mjs",
    status: "TODO",
    priority: "HIGH",
    assigneeIds: [],
    tags: ["smoke"],
    progress: 0,
  }),
});
body = await response.json();
const taskId = body.data?.id;
check("POST /api/tasks", response.ok && Boolean(taskId), `TF-${body.data?.reference}`);

response = await req(`/api/tasks/${taskId}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "IN_PROGRESS", progress: 45 }),
});
body = await response.json();
check("PATCH /api/tasks/:id", response.ok && body.data?.progress === 45, `progress ${body.data?.progress}`);

response = await req(`/api/tasks/${taskId}/comments`, {
  method: "POST",
  body: JSON.stringify({ body: "Smoke test comment" }),
});
check("POST /api/tasks/:id/comments", response.ok);

// --- 7. Settings mutation ---------------------------------------------------
response = await req("/api/settings", {
  method: "PATCH",
  body: JSON.stringify({
    section: "workingHours",
    values: {
      workdayStartMinutes: 540,
      workdayEndMinutes: 1080,
      gracePeriodMinutes: 20,
      fullDayHours: 8,
      halfDayHours: 4,
      weekendDays: [6, 7],
    },
  }),
});
body = await response.json();
check(
  "PATCH /api/settings (grace period → 20)",
  response.ok && body.data?.gracePeriodMinutes === 20,
  `${body.data?.gracePeriodMinutes} min`,
);

// --- 8. Geofence verdicts ---------------------------------------------------
async function verify(latitude, longitude, accuracyMeters) {
  const res = await req("/api/attendance/verify-location", {
    method: "POST",
    body: JSON.stringify({
      location: { latitude, longitude, accuracyMeters, capturedAt: new Date().toISOString() },
    }),
  });
  return { res, data: (await res.json()).data };
}

let verdict = await verify(16.30692, 80.4365, 12); // ~40 m north of Guntur HQ
check(
  "verify-location INSIDE perimeter",
  verdict.res.ok && verdict.data.allowed === true,
  `${Math.round(verdict.data?.distanceMeters ?? -1)} m · ${verdict.data?.verification}`,
);

verdict = await verify(16.30881, 80.4365, 12); // ~250 m north
check(
  "verify-location OUTSIDE perimeter",
  verdict.res.ok && verdict.data.allowed === false,
  `${Math.round(verdict.data?.distanceMeters ?? -1)} m > ${verdict.data?.requiredRadiusMeters} m`,
);

verdict = await verify(28.6139, 77.209, 5); // Delhi — a spoofed coordinate
check(
  "verify-location SPOOFED coordinate refused",
  verdict.res.ok && verdict.data.allowed === false,
  verdict.data?.verification,
);

verdict = await verify(16.30692, 80.4365, 800); // inside, but useless accuracy
check(
  "verify-location LOW ACCURACY refused",
  verdict.res.ok && verdict.data.allowed === false,
  verdict.data?.verification,
);

// --- 9. Check-in as an employee --------------------------------------------
await req("/api/dev/session", { method: "POST", body: JSON.stringify({ userId: employee.id }) });

response = await req("/api/attendance/check-in", {
  method: "POST",
  body: JSON.stringify({
    location: {
      latitude: 16.30881,
      longitude: 80.4365,
      accuracyMeters: 10,
      capturedAt: new Date().toISOString(),
    },
  }),
});
body = await response.json();
check(
  "check-in OUTSIDE perimeter refused (403)",
  response.status === 403 && body.error?.code === "GEOFENCE_REJECTED",
  `${Math.round(body.error?.meta?.distanceMeters ?? -1)} m`,
);

// --- 10. Permission boundaries ---------------------------------------------
response = await req("/api/settings", {
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
check("EMPLOYEE cannot change settings (403)", response.status === 403, String(response.status));

response = await req("/api/employees", {
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
check("EMPLOYEE cannot create employees (403)", response.status === 403, String(response.status));

response = await req("/api/attendance/override", {
  method: "POST",
  body: JSON.stringify({
    employeeId: employee.id,
    date: "2026-08-01",
    status: "PRESENT",
    reason: "Trying to forge my own attendance record",
  }),
});
check("EMPLOYEE cannot override attendance (403)", response.status === 403, String(response.status));

// --- 11. Leave ---------------------------------------------------------------
// A unique window per run: leave requests may not overlap, so a fixed range
// would pass once and then 409 on every later run.
const leaveStart = new Date(Date.now() + 90 * 86_400_000 + Math.floor(Math.random() * 120) * 86_400_000);
const leaveEnd = new Date(leaveStart.getTime() + 86_400_000);
const iso = (date) => date.toISOString().slice(0, 10);

response = await req("/api/leave", {
  method: "POST",
  body: JSON.stringify({
    type: "CASUAL",
    startDate: iso(leaveStart),
    endDate: iso(leaveEnd),
    days: 2,
    reason: "Smoke test leave request for verification",
  }),
});
body = await response.json();
check("POST /api/leave", response.ok && Boolean(body.data?.id), body.data?.status);

response = await req("/api/leave", {
  method: "POST",
  body: JSON.stringify({
    type: "SICK",
    startDate: iso(leaveEnd),
    endDate: iso(new Date(leaveEnd.getTime() + 86_400_000)),
    days: 2,
    reason: "Overlapping request, should be refused",
  }),
});
check("overlapping leave refused (409)", response.status === 409, String(response.status));

// --- 12. CSRF ---------------------------------------------------------------
const crossOrigin = await fetch(`${BASE}/api/tasks`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://evil.example",
    cookie: cookieHeader(),
  },
  body: JSON.stringify({ title: "cross-origin task" }),
});
check("cross-origin mutation rejected (403)", crossOrigin.status === 403, String(crossOrigin.status));

// --- Summary ----------------------------------------------------------------
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
  console.log("\nFailures:");
  for (const failure of failed) console.log(`  · ${failure.name} ${failure.detail}`);
  process.exitCode = 1;
}
