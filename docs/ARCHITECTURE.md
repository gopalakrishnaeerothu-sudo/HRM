# TaskFlow HR — architecture

A multi-tenant HRM, task-management and geofenced-attendance platform.
Next.js 15 (App Router) · TypeScript · PostgreSQL · deployed on Render.

Data access is plain SQL over the `pg` driver, through a repository layer.
There is no ORM.

---

## 1. Product shape

Four roles, four different products:

| Role | What the dashboard is |
|---|---|
| **Owner / Admin** | Organisation-wide operations: head count, attendance, task flow, office utilisation, location review, audit. |
| **HR** | The same organisation-wide view, minus destructive and configuration powers. |
| **Manager** | Their team: who is in, what they are working on, what is overdue. |
| **Employee** | Their own day: check in, today's tasks, their hours. |

These are separate components, not one page with things hidden. The role comes
from the server session and each dashboard's queries carry their own scope.

---

## 2. Layering

```
  Server Components (pages)          Client Components (interaction only)
            │                                     │
            ▼                                     ▼
        Services  ◄──────── auth boundary ────────┘
            │           (session + permissions)
            ▼
      Repositories  ◄──── TenantScope: every query filtered by organizationId
            │
            ▼
      pg driver  ──►  PostgreSQL
     (plain SQL)
```

Rules the layering enforces:

- **No SQL in components.** Pages call services; services call repositories.
- **No repository call without a scope.** `TenantScope` is the first argument
  of every repository function.
- **No authorisation in the client.** The permission list handed to the
  navigation decides which links are *drawn*; every route re-checks server-side.

### Directory map

```
src/
  app/
    (marketing)/          Public landing page
    app/                  Authenticated workspace
    api/                  Route handlers
  components/
    ui/                   Primitives — the design system in code
    landing/  app-shell/  dashboard/  tasks/  employees/
    attendance/  locations/  charts/  notifications/
  lib/
    validation/           Zod schemas, shared by forms AND the API
    design/               Chart tokens
    env.ts  db.ts  errors.ts  time.ts  utils.ts  branding.ts
  server/
    auth/                 The authentication boundary (see its README)
    geo/                  Distance maths + geofence verification
    repositories/         Tenant-scoped data access
    services/             Business logic, orchestration, audit
    api/handler.ts        The route wrapper every mutation passes through
```

---

## 3. Data model

25 tables. Every tenant-owned row carries `organizationId`, and every natural
key is unique **within** an organisation, never globally — so two companies can
both have an employee `EMP-0001` and a task `TF-1`.

```
organizations ─┬─ users ──────── sessions
               │     └─────────── notifications
               ├─ employees ─┬─ team_members ── teams ── departments
               │             ├─ employee_offices ── offices ── office_geofences
               │             ├─ attendance_records ─┬─ attendance_events
               │             │                      └─ break_records
               │             ├─ task_assignees ── tasks ─┬─ subtasks
               │             │                           ├─ task_comments
               │             │                           ├─ task_attachments
               │             │                           └─ task_activity
               │             └─ leaves
               ├─ holidays
               ├─ audit_logs
               └─ role_permissions ── permissions
```

### Decisions worth stating

**Soft deletion** (`deletedAt`) on employees, teams, tasks and offices. An
employee who leaves must not vacuum away a year of attendance history that
payroll and compliance depend on.

**`attendance_records` is one row per employee per day**, keyed
`@@unique([employeeId, date])`. That composite is what makes two concurrent
check-ins collapse into one record instead of racing.

**`attendance_events` is append-only.** Every check-in attempt — accepted *or
refused* — is written with its coordinates, accuracy, computed distance,
verification verdict and risk flags. Nothing updates these rows. This is what
turns "someone might be spoofing" from an unanswerable worry into a query.

**Dates.** `attendance_records.date` is a `DATE` anchored to midnight UTC.
*Which* calendar day a timestamp belongs to is decided in `lib/time.ts` using
the office's IANA timezone — never the server's, which is UTC on Railway and
anything at all on a laptop.

**Coordinates** are `double precision`, not `Decimal`. Double gives
sub-millimetre precision, several orders of magnitude finer than consumer GPS,
and avoids `Decimal.js` conversions on a value used in trigonometry.

**Indexes** are composite and lead with `organizationId`, because every query
filters on it:
`@@index([organizationId, date])`, `@@index([organizationId, status, deletedAt])`,
`@@index([organizationId, dueDate])`, `@@index([userId, readAt, createdAt])`.

---

## 4. Database access: migrating to plain SQL

The target architecture has no ORM: repositories issue SQL through the `pg`
driver, and the schema is defined by numbered migration files.

**Current state.** The repository layer is fully SQL: every repository in
`src/server/repositories/` issues plain SQL through `pg`, backed by integration
tests that run against a real PostgreSQL instance. Migrations and the seed are
plain SQL.

Prisma is gone: no client, no schema, no generate step, no dependency. Every
query goes through a repository issuing parameterised SQL. Historical comments
still mention Prisma where they explain *why* a query is shaped as it is —
those are deliberate, and describe what was replaced rather than what runs.

Verify rather than trusting this paragraph:

```
grep -rl "@prisma/client" src tests scripts      should return nothing
npm ls prisma @prisma/client                     should not resolve
```

### Migrations

`migrations/NNN_description.sql` — plain SQL, sequential, forward-only, one
logical change per file. Applied by `scripts/migrate.mjs`:

```
npm run db:migrate          apply anything pending
npm run db:migrate status   show what is applied
```

The runner records each file in `schema_migrations` with a SHA-256 checksum and
refuses to run if an already-applied file has changed — migrations are history,
not source you edit. Each migration runs inside its own transaction together
with its tracking row, so a failure leaves no half-applied schema and no false
record of success.

Checksums are taken over content with line endings normalised. Hashing raw
bytes made a Windows checkout report all fifteen migrations as modified, which
is a false alarm that teaches people to ignore the one warning that matters.

### Why not an ORM

The queries this application actually needs are the ones ORMs express worst: a
recursive CTE for the reporting tree, a GiST exclusion constraint for
overlapping leave, `json_agg` to nest members in a single round trip, and
`ON CONFLICT` to make concurrent check-ins collapse into one row. Writing them
directly means the database enforces the invariants rather than the
application hoping to.

### Rules

- **Parameterised queries only.** Never interpolate a value into SQL. Note that
  parameterisation prevents injection but does NOT stop `%` and `_` being read
  as wildcards inside a LIKE pattern — search paths use `likePattern()` and
  `ESCAPE ''`.
- **Identifiers** that must be dynamic (sort columns) go through an allow-list,
  never straight from a request.
- **Every repository takes a `TenantScope`** and folds `organizationId` into
  the query, including through join tables that carry no tenant column of their
  own — there the join IS the boundary.
- **Executors are explicit.** Every repository accepts one, so a call can be
  made to run inside a caller's transaction rather than silently outside it.

## 5. Multi-tenancy

The isolation mechanism is `TenantScope` in `repositories/tenant.ts`:

```ts
export interface TenantScope { organizationId: string; db?: DbClient }

export function liveTenantWhere(scope: TenantScope) {
  return { organizationId: scope.organizationId, deletedAt: null } as const;
}
```

Every read folds it into `where`. Every write uses `updateMany`/`deleteMany`
with the scope in the filter, so a cross-tenant id updates **zero rows** rather
than someone else's row.

**Cross-tenant reads return 404, never 403.** A 403 would confirm the id exists
somewhere, letting an attacker enumerate another organisation's id space by
watching status codes.

**Referenced ids are verified before use.** `assertBelongsToTenant` confirms
every `managerId`, `teamId`, `officeId` and `assigneeId` in a request body
lives in the caller's tenant before it becomes a foreign key.

Covered by `tests/integration/tenant-isolation.test.ts` — 19 tests that stand
up two real organisations and try to cross the boundary through every entry
point.

### Optional: PostgreSQL Row Level Security

The repository layer is the enforcement point today. For defence in depth, RLS
can be enabled so that even a repository bug cannot leak rows:

```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON employees
  USING (organization_id = current_setting('app.current_organization', true)::uuid);
```

That requires setting `app.current_organization` per connection, which in turn
requires a transaction-scoped `SET LOCAL` in `lib/db.ts`. It is not enabled by
default because it interacts badly with connection pooling, and the honest
position is that it should be turned on deliberately rather than assumed.

---

## 6. Geolocation

### The rule

> The client sends coordinates. The server decides everything else.

`checkInSchema` has no field for an office id, a distance, or an
`isInsideOffice` flag — there is nowhere to put a forged verdict. The server
resolves which offices the employee is assigned to, computes distance to each,
and returns the answer.

### Flow

```
  Browser: navigator.geolocation
        │  { latitude, longitude, accuracyMeters, capturedAt }
        ▼
  POST /api/attendance/check-in
        │
        ├─ auth boundary          who is this?  (session, never the body)
        ├─ permission             attendance:check-in
        ├─ rate limit             10 per minute per employee
        ├─ schema validation      Zod: ranges, types, timestamp format
        ▼
  attendanceService.checkIn
        │
        ├─ load the employee's assigned offices → candidate geofences
        ├─ load their last ACCEPTED fix         → travel-speed baseline
        ├─ load organisation policy             → accuracy / enforcement
        ▼
  verifyLocation()  ── pure, exhaustively unit-tested
        │
        ├─ structural validity   NaN, out of range, (0,0)
        ├─ timestamp sanity      future → refuse; stale → refuse
        ├─ accuracy gate         ±500 m can't decide a 100 m fence → refuse
        ├─ impossible travel     flag (does not refuse — see below)
        ├─ centre-exact match    flag: real GPS never returns this
        └─ distance vs radius    Haversine, per zone
        ▼
   allowed?  ── yes ─► one transaction: attendance_record + attendance_event
             └─ no  ─► attendance_event only, with the reason
```

### Why Haversine and not PostGIS

Radii here are 20–5000 m. Haversine's spherical-Earth error is ≤ 0.5% — under
half a metre at 100 m — an order of magnitude smaller than consumer GPS
accuracy (5–50 m). Keeping the maths in TypeScript means it runs on a stock
Railway Postgres image with no extension, and it is directly unit-testable.

Every caller goes through `distanceMeters`, so swapping to
`ST_DWithin(geography, geography, radius)` later is a change to one function.

### What the safeguards actually do

**Browser GPS can be spoofed.** A developer console, a rooted device or a
desktop emulator can report any coordinates. Nothing in a web application
changes that, and claiming otherwise would be dishonest.

What is implemented is a floor:

| Check | Behaviour | Why |
|---|---|---|
| Structural validity | **Refuse** | `NaN`, out-of-range, and `(0,0)` are bugs, not near-misses. |
| Future timestamp | **Refuse** | The shape a naive replay takes. |
| Stale fix (> 120 s) | **Refuse** | An old reading says nothing about now. |
| Accuracy > policy | **Refuse** | A ±500 m fix cannot decide a 100 m fence either way; accepting it is theatre. |
| Impossible travel | **Flag, allow** | The person *is* inside the perimeter; refusing would punish a legitimate check-in for a possibly-bad earlier fix. Surfaced for review. |
| Centre-exact match | **Flag, allow** | Real GPS never returns the centre to sub-metre precision — but it is evidence, not proof. |
| Outside geofence | **Refuse** (configurable) | The core rule. |

The refuse/flag split is deliberate: checks that indicate *bad data* fail
closed; checks that indicate *suspicion* fail open and leave a trail. Getting
that backwards would either let bad data through or lock out honest employees.

**The trail is the point.** Because refused attempts are logged too, someone
probing the boundary leaves an obvious pattern in the Location Review tab
rather than an invisible one.

`GeoRiskFlag` and the `riskFlags` column are open sets, so Play Integrity /
App Attest, mock-location detection, BLE beacons or Wi-Fi BSSID matching can be
added as extra flags without a schema change.

### Location data as sensitive data

- Employees see only their own coordinates and distances.
- Managers see status and distance for their reports — never raw coordinates.
- Office centres and radii are organisational configuration, visible to anyone
  with `office:read`.
- The geofence preview draws a schematic; **no map tiles are fetched**, because
  a third-party basemap request would leak office coordinates to that provider.
- `Cache-Control: no-store` on every `/api/*` response.
- `Permissions-Policy: geolocation=(self)`.

---

## 7. Security

### Every mutation

`src/server/api/handler.ts` wraps every route handler:

```
origin check → authentication → authorisation → rate limit → validation → handler → error mapping
```

Doing it in one place makes "every mutation is checked" structural rather than
a convention someone can forget.

### Never trusted from the client

`organizationId`, `employeeId`, `role`, `officeId`, `isInsideOffice`. All are
resolved from the server-side session. Where a client id *is* accepted (a task
id in a URL), it is looked up **within the caller's scope**, so a foreign id
resolves to nothing.

### Error handling

`toPublicError` maps anything thrown into a safe shape. Unknown errors are
logged server-side and returned as a generic 500 — a database error message can
contain a connection string or row contents. No stack trace ever reaches a
browser.

### Rate limiting — an honest limitation

`services/rate-limit.ts` is a fixed-window limiter with **in-process state**.
On one container that is the whole story; across N replicas the effective limit
is N× the configured one. Swap the `Map` for Redis `INCR`/`EXPIRE` to make it
cluster-wide — `consume()`'s signature does not change. The durable record is
separate: every attempt is written to `attendance_events` regardless.

### Audit

Written in the same transaction as the change it describes. Field-level diffs
with unchanged fields dropped and a redaction list applied. Geofence changes get
their own `GEOFENCE_CHANGE` action, because widening a radius from 100 m to 1 km
is an access-control change, not a cosmetic edit. There is no update or delete
path to `audit_logs` anywhere in the codebase.

---

## 8. Routes

| Path | Purpose |
|---|---|
| `/` | Landing page |
| `/app` | Role-dispatched dashboard |
| `/app/employees` · `/[id]` · `/[id]/edit` · `/new` | Directory, profile, CRUD |
| `/app/teams` | Teams and workload |
| `/app/tasks` · `/[id]` · `/new` | Board / list / calendar, detail, create |
| `/app/attendance` · `/my` | Team attendance + location review, personal |
| `/app/locations` | Offices and geofence editing |
| `/app/reports` | Attendance, tasks, working hours |
| `/app/notifications` · `/app/settings` · `/settings/audit` · `/settings/profile` | |
| `/app/leave` | Planned — see below |

### API

`/api/health` · `/api/employees` · `/api/tasks` (+ comments, subtasks) ·
`/api/attendance/{check-in, check-out, break, verify-location, override}` ·
`/api/offices` (+ geofences) · `/api/notifications` · `/api/search` ·
`/api/dev/session` *(development only)*

---

## 9. Design system

Tokens live in `src/app/globals.css`. Nothing hard-codes a colour.

- **Palette** defined in full on bare `:root`; dark redefined under both
  `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`, so the
  toggle wins in both directions and no colour is defined only in a media query.
- **Glass** in three tiers — `glass-panel` (chrome), `glass-card` (content),
  `glass-inset` (nested wells) — with an opaque `@supports not` fallback. Text
  never sits directly on blur without a solid tier beneath it.
- **Chart palette** is the validated eight-slot categorical set. Verified with
  the palette validator against this product's own surfaces (`#fbfcfe` light,
  `#141728` dark): lightness band, chroma floor, adjacent-pair CVD separation
  and normal-vision floor all pass in both modes. Three light-mode slots fall
  below 3:1 contrast, so charts ship direct labels and a table view.
- **Alignment** comes from shared primitives, not per-page CSS: `Field` owns
  every form row (label → control → message); `Card` has one padding scale;
  `Table` fixes column alignment; `TableWrap` owns horizontal scroll so a wide
  table never pushes the page sideways.

### Accessibility

Status is never colour alone — every badge carries a word, the attendance
calendar carries a letter, deltas carry an arrow and a direction word. Charts
with ≥ 2 series always show a legend and offer a table view. `prefers-reduced-
motion` collapses animation globally. Focus rings are uniform and always
visible. Pinch-zoom is not capped.

---

## 10. Deployment

```
   GitHub ──► Railway ──┬── Application (Next.js)
                        └── PostgreSQL
```

### Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | On Railway: `${{Postgres.DATABASE_URL}}` — reference, don't paste |
| `NEXT_PUBLIC_APP_URL` | ✅ | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `AUTH_SECRET` | ✅ | `openssl rand -base64 32` |
| `NODE_ENV` | ✅ | `production` |
| `STORAGE_URL` | — | Uploads are disabled when unset |
| `DEV_AUTH_ENABLED` | — | **Must be unset in production.** Refused anyway. |

Validated at boot by `lib/env.ts`, which fails loudly rather than starting
half-configured. Server and client schemas are separate, so a secret cannot
reach the browser.

### Release

`npm run release` = `node scripts/migrate.mjs && tsx seed/seed.ts --if-empty`.
Migrations run before the container takes traffic; the seed populates a
brand-new database once and no-ops afterwards.

### Health

`/api/health` queries the database, not just the process — a container that
answers HTTP but cannot reach Postgres is not healthy. Returns 503 on failure
so Railway replaces it. It reveals nothing about the database beyond up/down.

---

## 11. What is not built

Stated plainly rather than stubbed:

| Area | Status |
|---|---|
| **Authentication** | **Intentionally deferred.** Interface and dev adapter only — see `src/server/auth/README.md`. There is no login page, no password authentication, no OAuth, no OTP and no production sessions, because the current architecture requirement excludes them at this stage. This is a boundary, not a stub pretending to be authentication: `AuthAdapter` defines the contract, so adopting a real strategy later means supplying one implementation rather than changing the application. A previous attempt at password authentication was reverted for this reason; it remains recoverable on the `production-auth-v2` branch. |
| **File uploads** | `task_attachments` exists and renders; no upload endpoint. Gated on `STORAGE_URL`. |
| **PDF export** | CSV export is implemented and audited (§ below). PDF is not. |
| **Email / push** | `notifications` carries `channel` and `sentAt`; only `IN_APP` is delivered. `deliver()` in `notification-service.ts` is the seam. |
| **Self-service profile editing** | Needs a verified identity to attach to; ships with real auth. |
| **Distributed rate limiting** | In-process only — see §6. |
| **Payroll, performance, documents** | Route namespace reserved; nothing built. |

### Built and verified against a live database

Everything below runs end to end, exercised by `scripts/smoke-test.mjs`:

- **Leave** — request, withdraw, approve/decline with balances. Approval feeds
  `findApprovedLeave`, so approved days become ON_LEAVE in attendance.
  Overlapping requests are refused with 409.
- **Settings** — organisation profile, working hours, attendance/location
  policy and holidays are all editable, each section validated separately and
  each change audited. Turning geofence enforcement off is logged as a
  `PERMISSION_CHANGE`, not a plain update.
- **Attendance correction** — HR/admin dialog requiring a written reason,
  marking the row `isManualEntry` and writing an `ATTENDANCE_OVERRIDE` entry.
- **Offices** — full create/edit, including a "use my location" helper and a
  scale-accurate perimeter preview that redraws as the radius changes.
- **Teams** — create/edit with manager, department, colour and roster.
- **CSV export** — working-hours and attendance registers, scoped to the
  caller's visibility envelope, audited as `EXPORT`, with spreadsheet
  formula-injection neutralised and a UTF-8 BOM for Excel.

## 12. Testing

| Layer | Location | Runs |
|---|---|---|
| Unit — geo distance, geofence verification, attendance rules, permissions, CSV | `tests/unit` | Always. **107 tests.** |
| Integration — tenant isolation, attendance persistence | `tests/integration` | Skipped unless `TEST_DATABASE_URL` is set. **25 tests.** |
| Smoke — 39 live HTTP checks against a running server | `scripts/smoke-test.mjs` | Pages, CRUD, geofence verdicts, permission boundaries, CSRF. |
| Smoke — 39 checks over the real HTTP API | `scripts/smoke-test.mjs` | Against a running server with a seeded database. |
| E2E — check-in inside/outside, navigation, command palette, overflow | `tests/e2e` | Playwright, desktop + mobile. |

Test files run **serially** (`fileParallelism: false`): both integration suites
truncate the whole database in setup, and running them concurrently means one
wipes the other's fixtures. `tests/helpers/setup-env.ts` repoints
`DATABASE_URL` at `TEST_DATABASE_URL` before `@/lib/db` is imported, so a
repository call in a test can never reach the development database.

The smoke test is what caught the bugs that only appear at runtime: lucide icon
*components* being passed from Server Components into Client Components (React
cannot serialise a function across that boundary), and a `Response` returned by
a route handler being JSON-wrapped instead of streamed as a download.

Integration tests use a real database because the properties they check —
tenant isolation, unique constraints, cascades — are enforced *by* the database;
a mock would only prove the mock works. They skip rather than fail on a fresh
clone so `npm test` always passes.

The E2E suite drives geolocation through Playwright's `setGeolocation`, which is
exactly the surface a spoofer would use — so the "outside the perimeter" test
doubles as a demonstration that the server, not the client, decides.
