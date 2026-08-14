-- 015_search_and_reporting_indexes.sql
--
-- Indexes that exist for specific, known query patterns rather than "just in
-- case". Each one below names the query it serves; an index nobody can point
-- at a query for is a write-time cost with no reader.
--
-- Structural indexes (foreign keys, tenant scoping, uniqueness) were created
-- alongside their tables. This migration adds the ones that only make sense
-- once the whole query surface is known: search and reporting.

-- ---------------------------------------------------------------------------
-- Command palette search (/api/search)
--
-- Serves: employees matched by name, email, code or designation.
--
-- trigram indexes rather than full-text search, because the queries are
-- substring and prefix matches on short fields ("pri" → "Priya"), which
-- tsvector handles badly — it matches whole lexemes, so a partial word finds
-- nothing.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX employees_name_trgm_idx
    ON employees USING gin ((first_name || ' ' || last_name) gin_trgm_ops);

CREATE INDEX employees_email_trgm_idx ON employees USING gin (email gin_trgm_ops);

CREATE INDEX employees_designation_trgm_idx ON employees USING gin (designation gin_trgm_ops);

-- Serves: task search by title.
CREATE INDEX tasks_title_trgm_idx ON tasks USING gin (title gin_trgm_ops);

-- Serves: `tags @> ARRAY['frontend']` on the task board filter.
CREATE INDEX tasks_tags_idx ON tasks USING gin (tags);

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------

-- Serves: the overdue-task count and the overdue list, which filter on a due
-- date in the past AND a non-completed status. Partial, so it indexes only the
-- rows that can ever match — completed tasks are the majority over time.
CREATE INDEX tasks_overdue_idx
    ON tasks (organization_id, due_date)
    WHERE status <> 'COMPLETED' AND deleted_at IS NULL;

-- Serves: per-employee attendance history and the working-hours report, which
-- read one employee across a date range.
CREATE INDEX attendance_records_employee_date_idx
    ON attendance_records (employee_id, date DESC);

-- Serves: the late-arrivals figure on the reports page. Partial — most days
-- are not late, so this index stays a fraction of the table's size.
CREATE INDEX attendance_records_late_idx
    ON attendance_records (organization_id, date)
    WHERE late_by_minutes > 0;

-- Serves: the impossible-travel check, which fetches the most recent VERIFIED
-- fix for one employee. Partial and descending: the query wants exactly one row.
CREATE INDEX attendance_events_last_verified_fix_idx
    ON attendance_events (employee_id, occurred_at DESC)
    WHERE verification = 'VERIFIED' AND latitude IS NOT NULL;

-- Serves: the Location Review tab, which lists attempts carrying any risk
-- flag. Partial, because flagged events are rare by design.
CREATE INDEX attendance_events_flagged_idx
    ON attendance_events (organization_id, occurred_at DESC)
    WHERE risk_flags <> ARRAY[]::TEXT[];

-- Serves: the pending-approvals queue on the leave page.
CREATE INDEX leaves_pending_idx
    ON leaves (organization_id, start_date)
    WHERE status = 'PENDING';
