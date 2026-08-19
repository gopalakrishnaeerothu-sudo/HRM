-- 017_authentication.sql
--
-- Real authentication. Until now the only implementation was development
-- impersonation — a cookie holding a user id, trusted on sight — which is
-- refused in production, so a deployed instance had no way for anyone to sign
-- in at all.
--
-- ─── No new identity table ──────────────────────────────────────────────────
-- `users` already is the identity table: it holds the email, the role, the
-- status and the organisation, and `employees.user_id` already links a person
-- to it. A separate `auth_users` would duplicate all of that and immediately
-- raise the question of which one is authoritative. Credentials are added to
-- the row that already represents the account.
--
-- ─── Table naming ───────────────────────────────────────────────────────────
-- `sessions` rather than `auth_sessions`: src/server/auth/README.md and the
-- development adapter already refer to "the sessions table", and matching the
-- codebase's own vocabulary is worth more than a prefix.
--
-- ─── Enum values inside a transaction ───────────────────────────────────────
-- The runner wraps each migration in one transaction. Since PostgreSQL 12
-- ALTER TYPE ... ADD VALUE is allowed there, with one rule: the new value
-- cannot be *used* until the transaction commits. Nothing below uses them —
-- they are written by application code on later connections.

-- ─── Account states ─────────────────────────────────────────────────────────
-- LOCKED is distinct from DISABLED: DISABLED is an administrative decision to
-- end someone's access, LOCKED is the system's automatic response to repeated
-- failed sign-ins and clears itself. Collapsing them would make an attacker
-- able to trigger what looks like an HR action.
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'LOCKED';

-- ─── Security-event vocabulary ──────────────────────────────────────────────
-- LOGIN and LOGOUT already exist. These are the events an authentication
-- system must be able to account for afterwards.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LOGIN_FAILURE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_REQUESTED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_COMPLETED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ACCOUNT_DISABLED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'SESSION_REVOKED';

-- ─── Credentials on the existing account ────────────────────────────────────
ALTER TABLE users
    ADD COLUMN password_hash       TEXT,
    ADD COLUMN password_updated_at TIMESTAMPTZ;

-- Nullable on purpose. A password is one way to hold an account, not the only
-- one: seeded DEV accounts, and any future Google/Microsoft/SSO identity, have
-- none. NOT NULL here would force a placeholder hash onto every such row,
-- which is exactly the kind of "unusable but present" credential that later
-- gets treated as usable.
COMMENT ON COLUMN users.password_hash IS
    'Argon2id PHC string. NULL means this account cannot sign in with a password.';

-- ─── Brute-force accounting ─────────────────────────────────────────────────
-- Counted per account rather than per IP: an attacker rotates addresses
-- freely but cannot rotate the account they are trying to reach. Both columns
-- reset on any successful sign-in.
ALTER TABLE users
    ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN locked_until          TIMESTAMPTZ,
    ADD CONSTRAINT users_failed_attempts_non_negative CHECK (failed_login_attempts >= 0);

-- Case-insensitive uniqueness per tenant. `users_email_unique_per_org` already
-- exists but is case-sensitive, which would let alice@ and Alice@ both exist in
-- one organisation and make "which account did you mean" unanswerable at
-- sign-in. Lookup lowercases, so the index must too.
CREATE UNIQUE INDEX users_email_lower_unique_per_org
    ON users (organization_id, lower(email))
    WHERE deleted_at IS NULL;

-- ─── Sessions ───────────────────────────────────────────────────────────────
-- Server-side rather than a signed stateless token, because a stateless token
-- cannot be withdrawn before it expires. For a system holding attendance and
-- location history, "sign out everywhere" and "disable this account now" have
-- to take effect immediately, and that requires a row to revoke.
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Denormalised from the user so that session lookup — which happens on
    -- every authenticated request — establishes the tenant scope without a
    -- join.
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- SHA-256 of the cookie value, never the value itself, so a leaked backup
    -- yields no usable cookies. Plain SHA-256 is right here and a password
    -- hash would be wrong: the input is already 256 bits of randomness, so
    -- there is nothing to slow down, and this runs on every request.
    token_hash TEXT NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,

    -- Set rather than deleting the row, so "signed out at 14:02" survives as
    -- an auditable fact instead of becoming an absence of evidence.
    revoked_at     TIMESTAMPTZ,
    revoked_reason TEXT,

    -- Provenance, for showing someone their active sessions and for
    -- investigating a compromised account.
    ip_address INET,
    user_agent TEXT,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

-- Listing and bulk-revoking one user's sessions ("sign out everywhere").
CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);

-- Partial: expired and revoked rows are exactly what a sweep deletes, so
-- excluding them keeps the index proportional to sessions actually in use.
CREATE INDEX sessions_active_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE sessions IS
    'Server-side sessions. Setting revoked_at ends access on the next request.';

-- ─── Password reset ─────────────────────────────────────────────────────────
-- The schema is complete and the tokens are real; what is missing is an email
-- provider to deliver them. That gap is documented in README rather than
-- papered over with a pretend "email sent" response.
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- Hashed for the same reason session tokens are: the database must not
    -- hold anything that can be replayed against the application.
    token_hash TEXT NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,

    -- Single use. Recording *when* it was consumed, rather than deleting the
    -- row, makes a replay attempt visible instead of merely failing.
    consumed_at TIMESTAMPTZ,

    -- Who asked, for the audit trail.
    requested_ip INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT password_reset_tokens_hash_unique UNIQUE (token_hash),
    CONSTRAINT password_reset_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);

COMMENT ON TABLE password_reset_tokens IS
    'Single-use, expiring password reset tokens. Delivery requires an email provider — see README.';
