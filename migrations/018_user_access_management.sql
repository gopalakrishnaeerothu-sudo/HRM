-- 018_user_access_management.sql
--
-- Administrator-controlled access: self-signup that lands in a queue, and an
-- owner/admin surface that approves, rejects, suspends and re-roles accounts.
--
-- ─── Still no new identity table ────────────────────────────────────────────
-- 017 established that `users` *is* the identity record and that credentials
-- belong on it. The same reasoning applies to access state: a pending signup
-- is not a different kind of thing from a user, it is a user in a particular
-- state. A separate `signup_requests` table would duplicate email, name, phone
-- and organisation, then need reconciling with `users` at approval time — and
-- the moment those two disagree, the question of which one governs sign-in has
-- no good answer. PENDING is a value in `users.status`, and the session lookup
-- in src/server/auth/session-store.ts already refuses anything that is not
-- ACTIVE, so a queued account cannot hold a session by construction.
--
-- ─── Enum values inside a transaction ───────────────────────────────────────
-- As in 017: the runner wraps each migration in one transaction, and
-- PostgreSQL forbids *using* a newly added enum value before that transaction
-- commits. Nothing below reads or writes the new values — the backfill uses
-- only 'ACTIVE', which already existed.

-- ─── Access states ──────────────────────────────────────────────────────────
-- PENDING and REJECTED complete the lifecycle. They are deliberately distinct
-- from the three that already exist:
--
--   INVITED   an administrator created the account; it is expected and merely
--             unclaimed. Nobody needs to approve it.
--   PENDING   a stranger asked for access. It is NOT expected, and it must not
--             become usable until a human says so.
--   DISABLED  access was granted, then withdrawn.
--   REJECTED  access was requested, and never granted.
--   LOCKED    the system's automatic response to failed sign-ins (017).
--
-- Collapsing PENDING into INVITED would lose exactly the distinction the
-- feature exists to enforce, and collapsing REJECTED into DISABLED would make
-- "we turned this person away" indistinguishable from "this employee left".
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'REJECTED';

-- ─── Access-decision vocabulary ─────────────────────────────────────────────
-- ACCOUNT_DISABLED and SESSION_REVOKED already exist from 017 and are reused
-- rather than duplicated. These are the events they do not cover.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_SIGNUP';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_APPROVED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_REJECTED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_INVITED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ACCOUNT_ENABLED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ACCOUNT_LOCKED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ACCOUNT_UNLOCKED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ROLE_CHANGED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ACCESS_REVOKED';

-- ─── Which organisation is a stranger joining? ──────────────────────────────
-- Signup has to name a tenant, and the two ways of doing that are not equally
-- safe. Listing organisations in a public dropdown publishes the customer list
-- and lets anyone queue a PENDING row against any tenant they can see. A code
-- the administrator shares out of band does neither: a wrong code is refused
-- with one uniform message, so the form cannot be used to test whether an
-- organisation exists.
--
-- Globally unique, not per-tenant, because the code *is* the tenant selector —
-- it is resolved before any organisation is known.
ALTER TABLE organizations
    ADD COLUMN join_code TEXT,
    ADD CONSTRAINT organizations_join_code_unique UNIQUE (join_code),
    -- Format is fixed so the lookup can normalise input (upper-cased, spaces
    -- and dashes stripped) without the normalisation being ambiguous.
    ADD CONSTRAINT organizations_join_code_format
        CHECK (join_code IS NULL OR join_code ~ '^[A-Z0-9]{8,32}$');

COMMENT ON COLUMN organizations.join_code IS
    'Shared out of band to let staff self-request access. NULL disables signup for this tenant.';

-- NULL rather than a generated default: signup is off for every existing
-- organisation until its owner deliberately turns it on. A migration that
-- silently opened a public signup route on live tenants would be a security
-- change disguised as a schema change.

-- ─── Who decided, and when ──────────────────────────────────────────────────
-- audit_logs records the decision as an event; these columns carry the current
-- answer on the row itself, so the access table can render "approved by Asha,
-- 3 days ago" without a correlated subquery over the audit log on every page.
--
-- ON DELETE SET NULL — removing the reviewer's account must not erase the fact
-- that a decision was made.
ALTER TABLE users
    ADD COLUMN status_changed_at TIMESTAMPTZ,
    ADD COLUMN status_changed_by UUID REFERENCES users (id) ON DELETE SET NULL,
    -- Shown to administrators only. The sign-in path deliberately never
    -- returns it: "your request was declined because …" is the tenant's
    -- business, not something an unauthenticated caller gets to read.
    ADD COLUMN status_reason TEXT;

COMMENT ON COLUMN users.status_reason IS
    'Administrator note on the current status. Never returned by the sign-in path.';

-- Existing rows have a status that nobody set through the new flow. Recording
-- created_at as the moment is truthful — it is when the row reached the state
-- it is in — and leaving the actor NULL correctly says "not decided by anyone
-- through this feature".
UPDATE users SET status_changed_at = created_at WHERE status_changed_at IS NULL;

-- ─── The pending queue and the access table ─────────────────────────────────
-- One composite index serves both: the access table's status filter and
-- default ordering, and the "who is waiting" count that the page header and
-- the navigation badge both run on every render.
--
-- Deliberately NOT a partial index on `status = 'PENDING'`, which is what the
-- pending queue would otherwise want. PostgreSQL refuses to *use* an enum
-- value in the same transaction that added it, and the runner wraps each
-- migration in exactly one transaction — so a predicate naming PENDING here
-- fails at apply time. Leading with organization_id and status makes the
-- pending lookup an index scan over one short prefix anyway.
CREATE INDEX users_org_status_created_idx
    ON users (organization_id, status, created_at DESC)
    WHERE deleted_at IS NULL;
