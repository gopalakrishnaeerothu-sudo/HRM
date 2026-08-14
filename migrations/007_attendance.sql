-- 007_attendance.sql
--
-- The daily attendance record and its breaks.
--
-- One row per employee per calendar day, keyed UNIQUE (employee_id, date).
-- That composite is not decoration: it is what makes two simultaneous
-- check-ins collapse into one row instead of racing to create two.
--
-- `date` is DATE, not TIMESTAMPTZ. Which calendar day a check-in belongs to is
-- decided in application code using the *office's* IANA timezone, then stored
-- as a plain date. Storing an instant here would make "the 8th of August" mean
-- different things depending on where the query ran.

CREATE TABLE attendance_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    office_id       UUID REFERENCES offices (id) ON DELETE SET NULL,

    date DATE NOT NULL,

    check_in_at  TIMESTAMPTZ,
    check_out_at TIMESTAMPTZ,

    status attendance_status NOT NULL DEFAULT 'ABSENT',

    -- Derived totals, recomputed by the attendance service on every event.
    worked_minutes   INTEGER NOT NULL DEFAULT 0,
    break_minutes    INTEGER NOT NULL DEFAULT 0,
    overtime_minutes INTEGER NOT NULL DEFAULT 0,
    late_by_minutes  INTEGER NOT NULL DEFAULT 0,
    early_by_minutes INTEGER NOT NULL DEFAULT 0,

    -- Set when a privileged user edited the record. Always paired with an
    -- audit_logs entry naming the actor and the reason.
    is_manual_entry BOOLEAN NOT NULL DEFAULT FALSE,
    override_reason TEXT,
    notes           TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- The concurrency guarantee.
    CONSTRAINT attendance_records_one_per_employee_day UNIQUE (employee_id, date),

    CONSTRAINT attendance_records_checkout_after_checkin CHECK (
        check_in_at IS NULL OR check_out_at IS NULL OR check_out_at >= check_in_at
    ),
    CONSTRAINT attendance_records_non_negative CHECK (
        worked_minutes >= 0
        AND break_minutes >= 0
        AND overtime_minutes >= 0
        AND late_by_minutes >= 0
        AND early_by_minutes >= 0
    ),
    -- A manual entry must say why. This is the database refusing to hold an
    -- unexplained correction, not just the form asking nicely.
    CONSTRAINT attendance_records_override_needs_reason CHECK (
        NOT is_manual_entry OR override_reason IS NOT NULL
    )
);

CREATE TRIGGER attendance_records_set_updated_at
    BEFORE UPDATE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Dashboards and reports scan by organisation and date range.
CREATE INDEX attendance_records_org_date_idx ON attendance_records (organization_id, date);
CREATE INDEX attendance_records_org_status_date_idx
    ON attendance_records (organization_id, status, date);
CREATE INDEX attendance_records_office_date_idx ON attendance_records (office_id, date);

-- ---------------------------------------------------------------------------
-- Breaks
--
-- Subtracted from worked minutes. An open break (ended_at IS NULL) is closed
-- automatically at check-out rather than being left to inflate the day.
-- ---------------------------------------------------------------------------

CREATE TABLE break_records (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    employee_id          UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    attendance_record_id UUID NOT NULL REFERENCES attendance_records (id) ON DELETE CASCADE,

    started_at TIMESTAMPTZ NOT NULL,
    ended_at   TIMESTAMPTZ,
    minutes    INTEGER NOT NULL DEFAULT 0,
    reason     TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT break_records_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT break_records_non_negative CHECK (minutes >= 0)
);

CREATE INDEX break_records_attendance_idx ON break_records (attendance_record_id);
CREATE INDEX break_records_org_employee_idx ON break_records (organization_id, employee_id, started_at);

-- At most one open break per attendance record — otherwise "end break" is
-- ambiguous and break minutes double-count.
CREATE UNIQUE INDEX break_records_one_open_per_record
    ON break_records (attendance_record_id)
    WHERE ended_at IS NULL;
