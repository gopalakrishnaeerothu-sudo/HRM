-- 016_attendance_events_append_only.sql
--
-- Enforce at the database what migration 008 only described in a comment.
--
-- attendance_events is the evidence trail for every check-in attempt,
-- accepted or refused. Its value depends entirely on a row meaning the same
-- thing tomorrow as it did when it was written: if a REFUSED verdict can be
-- edited to VERIFIED afterwards, the log stops being evidence and becomes
-- merely a record of the last person to touch it.
--
-- 008 stated the intent. Nothing stopped an UPDATE. This closes that.
--
-- UPDATE only, deliberately — not DELETE. A foreign-key cascade fires the
-- child row's triggers, so a DELETE trigger here would make deleting an
-- organisation impossible, which is the same trap already documented on
-- audit_logs in migration 013. Retention and tenant deletion must stay
-- possible; silent revision must not.
--
-- Blocking DELETE for ordinary application roles is a deployment concern,
-- handled with a grant rather than a trigger:
--     REVOKE DELETE ON attendance_events FROM <application_role>;

CREATE OR REPLACE FUNCTION attendance_events_reject_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'attendance_events is append-only; UPDATE is not permitted'
        USING HINT = 'Append a new event describing the correction instead.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_events_no_update
    BEFORE UPDATE ON attendance_events
    FOR EACH ROW EXECUTE FUNCTION attendance_events_reject_update();
