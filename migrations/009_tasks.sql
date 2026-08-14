-- 009_tasks.sql
--
-- Tasks, their assignees and their subtasks.
--
-- `reference` is a per-tenant sequential number surfaced in the UI as TF-118.
-- It is unique per organisation rather than global, so each company counts
-- from 1 and nobody can infer platform-wide volume from their own task IDs.

CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

    reference   INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,

    status   task_status   NOT NULL DEFAULT 'TODO',
    priority task_priority NOT NULL DEFAULT 'MEDIUM',

    creator_id UUID REFERENCES employees (id) ON DELETE SET NULL,
    team_id    UUID REFERENCES teams (id) ON DELETE SET NULL,

    start_date   TIMESTAMPTZ,
    due_date     TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    estimated_hours NUMERIC(7,2),
    actual_hours    NUMERIC(7,2) NOT NULL DEFAULT 0,
    -- 0–100, kept in step with status by the task service.
    progress        SMALLINT NOT NULL DEFAULT 0,

    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Manual ordering within a kanban column. Fractional so a card can be
    -- dropped between two others without renumbering the column.
    board_order DOUBLE PRECISION NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT tasks_reference_unique_per_org UNIQUE (organization_id, reference),
    CONSTRAINT tasks_reference_positive CHECK (reference > 0),
    CONSTRAINT tasks_progress_range CHECK (progress BETWEEN 0 AND 100),
    CONSTRAINT tasks_due_after_start CHECK (
        start_date IS NULL OR due_date IS NULL OR due_date >= start_date
    ),
    CONSTRAINT tasks_hours_non_negative CHECK (
        actual_hours >= 0 AND (estimated_hours IS NULL OR estimated_hours >= 0)
    ),
    -- A completed task has a completion time, and only a completed task does.
    CONSTRAINT tasks_completed_consistency CHECK (
        (status = 'COMPLETED') = (completed_at IS NOT NULL)
    )
);

CREATE TRIGGER tasks_set_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX tasks_org_status_idx ON tasks (organization_id, status, deleted_at);
CREATE INDEX tasks_org_due_idx ON tasks (organization_id, due_date);
CREATE INDEX tasks_org_team_idx ON tasks (organization_id, team_id);
CREATE INDEX tasks_org_priority_status_idx ON tasks (organization_id, priority, status);

-- ---------------------------------------------------------------------------
-- Assignees
--
-- Many per task, with at most one accountable owner.
-- ---------------------------------------------------------------------------

CREATE TABLE task_assignees (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    is_owner    BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT task_assignees_unique UNIQUE (task_id, employee_id)
);

-- "What is assigned to this person?" drives every workload figure.
CREATE INDEX task_assignees_employee_idx ON task_assignees (employee_id);

-- One accountable owner per task, enforced rather than merely intended.
CREATE UNIQUE INDEX task_assignees_one_owner_per_task
    ON task_assignees (task_id)
    WHERE is_owner;

-- ---------------------------------------------------------------------------
-- Subtasks
-- ---------------------------------------------------------------------------

CREATE TABLE subtasks (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,

    title        TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT subtasks_completed_consistency CHECK (
        is_completed = (completed_at IS NOT NULL)
    )
);

CREATE INDEX subtasks_task_position_idx ON subtasks (task_id, position);
