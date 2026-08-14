-- 011_leave_and_holidays.sql
--
-- Leave requests and the company calendar.
--
-- Approved leave is not just a record: it is consulted on every attendance
-- computation, turning a day that would read ABSENT into ON_LEAVE. That
-- coupling is why approval is permission-gated and audited, and why the
-- overlap constraint below matters — two overlapping approved requests would
-- make "which leave covers this day?" ambiguous.

CREATE TABLE leaves (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,

    type       leave_type   NOT NULL,
    status     leave_status NOT NULL DEFAULT 'PENDING',
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    -- Fractional to support half days.
    days       NUMERIC(5,1) NOT NULL,
    reason     TEXT,

    reviewer_id UUID REFERENCES employees (id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT leaves_end_after_start CHECK (end_date >= start_date),
    CONSTRAINT leaves_days_positive CHECK (days > 0),
    -- Half-day granularity: 0.5, 1, 1.5 … but never 0.3.
    CONSTRAINT leaves_days_half_steps CHECK ((days * 2) = floor(days * 2)),
    -- A decided request records who decided it and when.
    CONSTRAINT leaves_review_consistency CHECK (
        status IN ('PENDING', 'CANCELLED') OR reviewed_at IS NOT NULL
    ),
    -- Nobody approves their own leave. The service checks this too; the
    -- database makes it impossible.
    CONSTRAINT leaves_reviewer_is_not_requester CHECK (
        reviewer_id IS NULL OR reviewer_id <> employee_id
    )
);

CREATE TRIGGER leaves_set_updated_at
    BEFORE UPDATE ON leaves
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX leaves_org_employee_start_idx ON leaves (organization_id, employee_id, start_date);
CREATE INDEX leaves_org_status_idx ON leaves (organization_id, status);

-- ---------------------------------------------------------------------------
-- Overlap prevention
--
-- An exclusion constraint over a date range, restricted to the states that
-- actually reserve time. PENDING and APPROVED block; REJECTED and CANCELLED do
-- not, so withdrawing a request frees the dates immediately.
--
-- daterange(start, end, '[]') is inclusive at both ends, matching how people
-- read "1st to 2nd" — two days, not one.
--
-- This is what produces the 409 the application returns on an overlapping
-- request, and it holds even under concurrent submissions, which an
-- application-level SELECT-then-INSERT check does not.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE leaves
    ADD CONSTRAINT leaves_no_overlap_per_employee
    EXCLUDE USING gist (
        employee_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    )
    WHERE (status IN ('PENDING', 'APPROVED'));

-- ---------------------------------------------------------------------------
-- Company holidays
--
-- A day listed here is recorded as HOLIDAY rather than counted as a working
-- day, so attendance rates are not dragged down by public holidays.
-- ---------------------------------------------------------------------------

CREATE TABLE holidays (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

    name        TEXT NOT NULL,
    date        DATE NOT NULL,
    is_optional BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Name included: some organisations observe two distinct holidays on one
    -- date, and the pair is what should be unique.
    CONSTRAINT holidays_unique_per_org_date_name UNIQUE (organization_id, date, name)
);

CREATE INDEX holidays_org_date_idx ON holidays (organization_id, date);
