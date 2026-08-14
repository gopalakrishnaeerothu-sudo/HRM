-- 004_users_and_departments.sql
--
-- Two tables that both sit between the organisation and the employee, and both
-- must exist before `employees` (005) can reference them.
--
-- `users` is the identity record. AUTHENTICATION IS INTENTIONALLY DEFERRED —
-- there is deliberately no password column, no credential of any kind, and no
-- session table. What exists is the shape a future provider will attach to:
-- `provider` plus `provider_account_id`, uniquely constrained together, so
-- Google, Microsoft, SSO or a password scheme can be added later without
-- touching a business table. See src/server/auth/README.md.

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

    email          TEXT NOT NULL,
    email_verified TIMESTAMPTZ,
    phone          TEXT,
    name           TEXT NOT NULL,
    avatar_url     TEXT,
    role           user_role   NOT NULL DEFAULT 'EMPLOYEE',
    status         user_status NOT NULL DEFAULT 'ACTIVE',

    -- Identity provenance. 'DEV' means the seeded development context, which
    -- is the only thing that exists today.
    provider            auth_provider NOT NULL DEFAULT 'DEV',
    provider_account_id TEXT,

    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ,

    -- One account per email per tenant. The same person may legitimately hold
    -- accounts in two organisations, so this is not globally unique.
    CONSTRAINT users_email_unique_per_org UNIQUE (organization_id, email),
    CONSTRAINT users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX users_org_role_idx ON users (organization_id, role);
CREATE INDEX users_org_status_idx ON users (organization_id, status);

-- One external identity maps to one user. Partial, so the many rows with no
-- external provider do not collide on NULL.
CREATE UNIQUE INDEX users_provider_account_unique
    ON users (provider, provider_account_id)
    WHERE provider_account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Departments
--
-- `head_id` is added later, in 005, because it references `employees` — which
-- in turn references departments. The cycle is broken by adding one side after
-- both tables exist.
-- ---------------------------------------------------------------------------

CREATE TABLE departments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

    name        TEXT NOT NULL,
    code        TEXT NOT NULL,
    description TEXT,
    -- Hex accent used by charts and badges for this department.
    color       TEXT NOT NULL DEFAULT '#6366f1',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT departments_code_unique_per_org UNIQUE (organization_id, code),
    CONSTRAINT departments_color_format CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE TRIGGER departments_set_updated_at
    BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX departments_org_idx ON departments (organization_id, deleted_at);
