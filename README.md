# TaskFlow HR

A multi-tenant HRM, task-management and **geofenced attendance** platform.

> One workspace for your people, tasks and attendance.

Next.js 15 · TypeScript · PostgreSQL (Prisma) · Tailwind v4 · Railway

`TaskFlow HR` is a working name. It lives in one place — `src/lib/branding.ts`,
fed by `NEXT_PUBLIC_APP_NAME` — so renaming the product needs no code changes.

---

## What it does

- **People** — directory, profiles, departments, teams, reporting lines.
- **Tasks** — board, list and calendar views over one dataset; priorities,
  progress, subtasks, comments and a full activity timeline.
- **Attendance** — check-in/out, breaks, working hours, overtime, late arrivals,
  monthly calendar.
- **Geofencing** — check-in is verified **server-side** against the office
  perimeter. The browser sends coordinates and nothing else.
- **Reports** — attendance trends, task flow, working hours, department workload.
- **Audit** — append-only trail of every sensitive change.

Four role experiences: Admin, HR, Manager, Employee.

---

## Quick start

**Prerequisites:** Node 20+, PostgreSQL 14+.

```bash
git clone <your-repo> && cd taskflow-hr
npm install

cp .env.example .env      # then set DATABASE_URL and AUTH_SECRET

npm run db:migrate        # create the schema
npm run db:seed           # 22 employees, 2 offices, 18 tasks, 60 days of attendance

npm run dev               # http://localhost:3000
```

No local PostgreSQL? Either is fine:

```bash
# Docker
docker run --name taskflow-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=taskflow_hr -p 5432:5432 -d postgres:16

# …or provision a Postgres on Railway and paste its URL into .env
```

### Signing in

There is **no sign-in page**, because authentication is not implemented yet and
a form that accepts any password would be worse than none.

In development, `DEV_AUTH_ENABLED=true` lands you on the seeded owner account.
The **flask icon** in the top bar switches between seeded users so you can see
all four role dashboards. This is refused outright in production —
see [`src/server/auth/README.md`](src/server/auth/README.md).

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit + integration (integration skips without a test DB) |
| `npm run test:e2e` | Playwright, desktop + mobile |
| `npm run dev:db` · `dev:db:stop` · `dev:db:reset` | Local PostgreSQL, no Docker needed |
| `npm run db:migrate` · `db:seed` · `db:studio` · `db:reset` | Database |
| `npm run release` | `migrate deploy && seed --if-empty` — the Railway release step |

---

## Deploying to Railway

1. **New Project → Deploy from GitHub repo.**
2. **Add a PostgreSQL service** (`+ New → Database → PostgreSQL`).
3. **Set variables** on the app service:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   NEXT_PUBLIC_APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   AUTH_SECRET=<openssl rand -base64 32>
   NODE_ENV=production
   ```

   Do **not** set `DEV_AUTH_ENABLED`.

4. **Deploy.** `railway.json` and `nixpacks.toml` handle the rest: build,
   `prisma migrate deploy`, seed-if-empty, then start. Health checks hit
   `/api/health`, which verifies the database is actually reachable.

A `Dockerfile` is included for container deploys elsewhere; Railway's default
Nixpacks path does not need it.

---

## Architecture in one page

```
Server Components → Services → Repositories → Prisma → PostgreSQL
                        ▲            ▲
                auth boundary   TenantScope (organizationId on every query)
```

Three properties worth knowing:

**Tenant isolation is structural.** Every repository function takes a
`TenantScope` and folds `organizationId` into the query. Cross-tenant reads
return 404, never 403 — a 403 would confirm the id exists elsewhere.

**The client never decides a geofence.** `checkInSchema` has no field for an
office id, a distance, or an `isInsideOffice` flag. There is nowhere to put a
forged verdict.

**Every mutation passes through one wrapper** that applies origin check → auth →
permission → rate limit → validation → error mapping.

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## On anti-spoofing — read this

Browser GPS **can be spoofed**. A developer console or a rooted device can
report any coordinates, and no web application can prevent that. This product
does not claim otherwise.

What it does provide:

- The verdict is computed **server-side**, every time, from the office record.
- Invalid, stale and low-accuracy readings are **refused**.
- Impossible travel and centre-exact coordinates are **flagged** and surfaced
  for review.
- Every attempt — accepted *or refused* — is written to an append-only log with
  its coordinates, accuracy, distance and risk flags.

The result is that tampering leaves a trail rather than being invisible.
`GeoRiskFlag` is an open set, so platform attestation (Play Integrity / App
Attest), mock-location detection or BLE beacons slot in as additional flags
without a schema change.

---

## What is not built

Documented rather than stubbed:

- **Authentication** — interface and dev adapter only. This is the one
  deliberate gap; everything else in the product is wired end to end.
- **File uploads** — model and rendering exist; no upload endpoint, because
  there is no storage provider to write to. Gated on `STORAGE_URL`.
- **PDF export** — CSV works and is audited; PDF is not implemented.
- **Email/push notifications** — `IN_APP` is delivered; the transport seam is
  marked in `notification-service.ts`.
- **Distributed rate limiting** — the limiter is per-process.

Full list with reasoning: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §10.

---

## Testing

```bash
npm test                 # 107 unit tests
npm run test:integration # + 25 integration tests against a real database
npm run test:e2e:install && npm run test:e2e

# 39 checks over the real HTTP API, against a running server
npm run build && npx next start -p 3100
node scripts/smoke-test.mjs
```

Integration tests hit a real database — tenant isolation and unique constraints
are enforced *by* PostgreSQL, so mocking them would only prove the mock works.
They skip cleanly when `TEST_DATABASE_URL` is unset.

Point `TEST_DATABASE_URL` at a **throwaway** database. It gets truncated.
