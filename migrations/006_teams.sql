-- 006_teams.sql
--
-- Teams and their rosters.
--
-- Membership is not merely cosmetic grouping: a manager's visibility envelope
-- includes the members of teams they manage, so adding someone to a team grants
-- that manager sight of their attendance and tasks. That is why team changes
-- are audited by the service layer.

CREATE TABLE teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    description TEXT,
    color       TEXT NOT NULL DEFAULT '#8b5cf6',

    department_id UUID REFERENCES departments (id) ON DELETE SET NULL,
    manager_id    UUID REFERENCES employees (id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT teams_slug_unique_per_org UNIQUE (organization_id, slug),
    CONSTRAINT teams_color_format CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE TRIGGER teams_set_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX teams_org_idx ON teams (organization_id, deleted_at);

CREATE TABLE team_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    -- Free-form role within the team, e.g. "Tech Lead".
    role_label  TEXT,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT team_members_unique UNIQUE (team_id, employee_id)
);

-- "Which teams is this person in?" is asked on every visibility-envelope
-- resolution, so the reverse direction needs its own index.
CREATE INDEX team_members_employee_idx ON team_members (employee_id);
