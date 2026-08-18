-- 017_sessions_and_passwords.sql
--
-- Everything a real sign-in needs, which the schema so far has not had.
--
-- Until now the only authentication was development impersonation: a cookie
-- holding a user id, trusted on sight. That is refused in production, so a
-- deployed instance had no way for anyone to sign in at all. This migration
-- adds the two things a password adapter requires — somewhere to keep a
-- password verifier, and somewhere to keep issued sessions.
--
-- ─── Why sessions live in the database ──────────────────────────────────────
-- The alternative, a signed stateless token, cannot be revoked before it
-- expires. For an HR system holding attendance and location history, "sign out
-- everywhere" and "disable this account now" have to take effect immediately,
-- and that requires server-side state to delete.

-- ─── Password verifiers on the user ─────────────────────────────────────────
-- Nullable, because a password is only one way to hold an account. The seeded
-- DEV users, and any future Google/Microsoft/SSO identity, have no password
-- and must not be given a placeholder one — a NOT NULL column here would
-- invite exactly that.
--
-- The column stores a scrypt verifier, never a password. Format and
-- parameters are documented at src/server/auth/password.ts.
ALTER TABLE users
    ADD COLUMN password_hash       TEXT,
    ADD COLUMN password_updated_at TIMESTAMPTZ;

-- ─── Brute-force resistance ─────────────────────────────────────────────────
-- Counted per account rather than per IP: an attacker rotates addresses freely
-- but cannot rotate the account they are trying to reach. Both columns are
-- reset on any successful sign-in.
ALTER TABLE users
    ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN locked_until          TIMESTAMPTZ;

COMMENT ON COLUMN users.password_hash IS
    'scrypt verifier — see src/server/auth/password.ts. NULL for accounts that authenticate another way.';

-- ─── Sessions ───────────────────────────────────────────────────────────────
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Denormalised from the user so that session lookup, which happens on
    -- every single request, does not need to join before it can establish the
    -- tenant scope.
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- SHA-256 of the cookie value, never the value itself. A leaked database
    -- backup then yields no usable cookies. Unique because two sessions
    -- colliding here would mean one silently hijacking the other.
    token_hash TEXT NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,

    -- Set instead of deleting the row, so that "signed out at 14:02" survives
    -- as an auditable fact rather than becoming an absence of evidence.
    revoked_at TIMESTAMPTZ,

    -- Provenance, for showing a user their active sessions and for
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

-- Partial: expired and revoked rows are exactly the ones a sweep deletes, and
-- excluding them keeps the index proportional to sessions actually in use.
CREATE INDEX sessions_active_idx ON sessions (expires_at)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE sessions IS
    'Server-side sessions. Deleting a row, or setting revoked_at, ends access immediately.';
