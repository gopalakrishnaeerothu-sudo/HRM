-- 005_employees.sql
--
-- The people record, and the point where several circular references are
-- finally closed:
--
--   employees.department_id     → departments   (created in 004)
--   employees.manager_id        → employees     (self-reference)
--   employees.primary_office_id → offices       (created in 003)
--   departments.head_id         → employees     (added at the end of this file)
--
-- Employees are soft-deleted. Someone who leaves must not vacuum away a year
-- of attendance history that payroll and compliance depend on, so the row
-- stays and `deleted_at` is set.

CREATE TABLE employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

    -- Human-facing staff number, e.g. "ACME-0042".
    employee_code TEXT NOT NULL,

    -- The login identity, when this person has one. Nullable: an employee
    -- record can exist before any account is issued, which is exactly the
    -- state the product is in while authentication is deferred.
    -- ON DELETE SET NULL — removing an account must not delete the person.
    user_id UUID UNIQUE REFERENCES users (id) ON DELETE SET NULL,

    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    email       TEXT NOT NULL,
    phone       TEXT,
    avatar_url  TEXT,
    designation TEXT NOT NULL,
    bio         TEXT,

    department_id     UUID REFERENCES departments (id) ON DELETE SET NULL,
    manager_id        UUID REFERENCES employees (id) ON DELETE SET NULL,
    primary_office_id UUID REFERENCES offices (id) ON DELETE SET NULL,

    employment_type employment_type NOT NULL DEFAULT 'FULL_TIME',
    status          employee_status NOT NULL DEFAULT 'ACTIVE',
    joined_at       TIMESTAMPTZ NOT NULL,
    exited_at       TIMESTAMPTZ,

    -- Personal override of the office working window, in local minutes.
    shift_start_minutes INTEGER,
    shift_end_minutes   INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT employees_code_unique_per_org UNIQUE (organization_id, employee_code),
    CONSTRAINT employees_email_unique_per_org UNIQUE (organization_id, email),

    -- Nobody manages themselves. A longer reporting cycle is checked in the
    -- service layer, since SQL cannot express it cheaply.
    CONSTRAINT employees_not_own_manager CHECK (manager_id IS NULL OR manager_id <> id),
    CONSTRAINT employees_exit_after_join CHECK (exited_at IS NULL OR exited_at >= joined_at),
    CONSTRAINT employees_shift_order CHECK (
        shift_start_minutes IS NULL
        OR shift_end_minutes IS NULL
        OR shift_end_minutes > shift_start_minutes
    ),
    CONSTRAINT employees_shift_bounds CHECK (
        (shift_start_minutes IS NULL OR shift_start_minutes BETWEEN 0 AND 1439)
        AND (shift_end_minutes IS NULL OR shift_end_minutes BETWEEN 1 AND 1440)
    )
);

CREATE TRIGGER employees_set_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX employees_org_status_idx ON employees (organization_id, status, deleted_at);
CREATE INDEX employees_org_department_idx ON employees (organization_id, department_id);
CREATE INDEX employees_org_manager_idx ON employees (organization_id, manager_id);
CREATE INDEX employees_org_office_idx ON employees (organization_id, primary_office_id);

-- ---------------------------------------------------------------------------
-- Additional office access
--
-- Beyond their primary office. Together these form the candidate set a
-- check-in is verified against — the server derives it from here, never from
-- an office id supplied by the client.
-- ---------------------------------------------------------------------------

CREATE TABLE employee_offices (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    office_id   UUID NOT NULL REFERENCES offices (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employee_offices_unique UNIQUE (employee_id, office_id)
);

CREATE INDEX employee_offices_office_idx ON employee_offices (office_id);

-- ---------------------------------------------------------------------------
-- Close the departments → employees cycle
-- ---------------------------------------------------------------------------

ALTER TABLE departments
    ADD COLUMN head_id UUID REFERENCES employees (id) ON DELETE SET NULL;
