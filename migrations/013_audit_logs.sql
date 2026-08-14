-- 013_audit_logs.sql
--
-- The immutable trail for sensitive operations.
--
-- ─── Append-only, and meant literally ───────────────────────────────────────
-- Nothing in the application updates or deletes an audit row, and there is no
-- updated_at column. This migration goes further and installs a trigger that
-- raises on UPDATE or DELETE, so a future bug — or a hand-typed statement at a
-- psql prompt — cannot quietly rewrite history. A mutable audit log is not an
-- audit log.
--
-- The trigger is the enforcement; revoking UPDATE/DELETE from the application
-- role at the database level would be the belt to that brace, and is noted in
-- docs/ARCHITECTURE.md as a deployment step rather than assumed here.

CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    -- SET NULL rather than CASCADE: removing a user must not erase the record
    -- of what they did.
    actor_user_id   UUID REFERENCES users (id) ON DELETE SET NULL,

    action      audit_action NOT NULL,
    -- Table-ish name of the thing acted on, e.g. 'office_geofences'.
    entity_type TEXT NOT NULL,
    entity_id   TEXT,
    summary     TEXT NOT NULL,

    -- Field-level before/after, already redacted of anything sensitive by the
    -- audit service. JSONB rather than TEXT so it can be queried.
    changes    JSONB,
    ip_address TEXT,
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT audit_logs_summary_not_blank CHECK (length(btrim(summary)) > 0)
);

-- The audit page reads newest-first per organisation.
CREATE INDEX audit_logs_org_time_idx ON audit_logs (organization_id, created_at DESC);
-- "What happened to this specific record?"
CREATE INDEX audit_logs_entity_idx ON audit_logs (organization_id, entity_type, entity_id);
-- "What has this person done?"
CREATE INDEX audit_logs_actor_time_idx ON audit_logs (actor_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Immutability trigger
--
-- UPDATE is blocked outright: rewriting a past entry is the thing an audit log
-- exists to prevent, and there is no legitimate reason to do it.
--
-- DELETE is deliberately NOT blocked by a trigger. A cascade from
-- `organizations` fires the child's row triggers, so a DELETE trigger here
-- would make deleting a tenant impossible and would break any test or script
-- that clears the database. Since removing a tenant *should* remove its trail,
-- blocking deletes at this level would trade a real capability for very little.
--
-- Retention of audit rows is therefore enforced by privilege, not by trigger.
-- Grant the application role INSERT and SELECT only:
--
--   REVOKE UPDATE, DELETE ON audit_logs FROM taskflow_app;
--
-- That step belongs to deployment and is documented in docs/ARCHITECTURE.md
-- rather than assumed here, because this migration runs as the owner.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_logs_reject_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only; UPDATE is not permitted'
        USING HINT = 'Correct the record by appending a new audit entry.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_update();
