# The authentication boundary

Authentication is **not implemented**. This folder is the seam where it will
attach, and it is designed so that attaching it touches nothing else.

There is deliberately no fake OAuth, no mock token endpoint, and no login form
that accepts any password. A form that looks like security but isn't is worse
than an honest gap: it invites someone to ship it.

## What exists

| File | Role |
|---|---|
| `types.ts` | The `AuthAdapter` interface and the `AuthSession` shape every caller depends on. |
| `permissions.ts` | Role → capability map. The only place that decides what a role may do. |
| `dev-adapter.ts` | Development-only impersonation. No credential is ever checked. |
| `index.ts` | Picks the adapter, and exposes `getSession` / `requireSession` / `requirePermission`. |

Nothing outside this folder imports an adapter directly. Pages and route
handlers call `requireSession()` and `requirePermission()`, so swapping the
implementation is a one-file change.

## The development adapter

`dev-adapter.ts` lets you view the app as any seeded user so the four role
experiences can be demonstrated before real sign-in exists. It performs **no
authentication whatsoever** — the cookie holds a user id, and that user is
loaded. Anyone who can set a cookie can become anyone.

It is fenced twice:

```ts
if (isProduction) throw new Error("…");           // NODE_ENV
if (!serverEnv().DEV_AUTH_ENABLED) throw errors.unauthenticated();
```

Both must pass. A production deployment that forgets to unset
`DEV_AUTH_ENABLED` still fails closed rather than opening a door. The
`/api/dev/*` routes apply the same guard independently, so the API cannot be
reached even if the UI is bypassed.

## Adding a real provider

1. **Implement `AuthAdapter`.** Three methods: `getSession`, `signIn`,
   `signOut`. Return the same `AuthSession` shape the dev adapter builds — the
   rest of the application already consumes it.

2. **Register it** in `index.ts`:

   ```ts
   function resolveAdapter(): AuthAdapter {
     if (!isProduction && serverEnv().DEV_AUTH_ENABLED) return devAuthAdapter;
     return myProductionAdapter;   // ← here
   }
   ```

3. **Delete `src/app/api/dev/`** and `dev-role-switcher.tsx`. Nothing else
   imports them.

### What the database already provides

The `sessions` table is ready for a cookie-based implementation:

| Column | Purpose |
|---|---|
| `tokenHash` | SHA-256 of the cookie value. **Never store the raw token.** |
| `expiresAt` | Absolute expiry; compare against `now()` on every read. |
| `revokedAt` | Set on sign-out and on password change, to kill live sessions. |
| `ipAddress`, `userAgent` | For a "your active sessions" screen. |

The `users` table carries `provider` and `providerAccountId`, uniquely
constrained together, so Google, Microsoft and SSO subjects map onto a user
without a schema change. `AuthProvider` already enumerates
`PASSWORD | OTP | GOOGLE | MICROSOFT | SSO`.

### The session-cookie adapter

Implemented in `production-adapter.ts`, backed by `session-store.ts`. The
cookie carries 32 random bytes; only its SHA-256 is stored, so a leaked backup
yields nothing replayable. Lookup, tenant scope and account status resolve in
one statement:

```sql
SELECT … FROM sessions s
  JOIN users u         ON u.id = s.user_id
  JOIN organizations o ON o.id = u.organization_id
 WHERE s.token_hash = $1
   AND s.revoked_at IS NULL
   AND s.expires_at > NOW()
   AND u.status = 'ACTIVE'
```

Putting the status and soft-delete filters in the lookup rather than checking
them afterwards is what makes disabling an account take effect on the very
next request, with no session sweep.

The cookie is `httpOnly`, `secure` in production, `sameSite: "lax"`, scoped to
`/`. `server/http/origin.ts` adds an origin check on authentication mutations,
which pairs with `SameSite=Lax`.

## Where authorisation happens

Authentication answers *who*; authorisation answers *what*. They are separate:

- **`requirePermission(permission)`** — role gate, applied per route.
- **`resolveVisibleEmployeeIds(session)`** in `services/access-service.ts` —
  the row-level envelope. A manager sees their report tree; an employee sees
  themselves.
- **`TenantScope`** in `db/tenant.ts` — every query is filtered by
  `organization_id`.

All three are server-side. The client's permission list exists only to decide
which links to *draw*; hiding a link is not access control, and every route
re-checks.
