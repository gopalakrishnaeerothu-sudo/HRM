-- 014_permissions_and_role_overrides.sql
--
-- The permission catalogue, and per-tenant overrides on top of it.
--
-- Role → permission mapping lives in code (src/server/auth/permissions.ts),
-- not in this database. That is deliberate: the defaults are a security
-- decision that belongs in reviewed, version-controlled source, not in rows
-- an admin UI could quietly edit. `permissions` is a catalogue for display and
-- referential integrity; `role_permissions` records the exceptions.
--
-- An override is a grant OR a revoke, so a tenant can both extend a role and
-- take something away from it — a revoke on ADMIN is honoured, with no
-- implicit bypass for privileged roles.

CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Matches the string union in src/server/auth/permissions.ts,
    -- e.g. 'attendance:override'. Globally unique — it is a platform concept.
    key         TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    description TEXT,
    -- Leading segment of the key, used to group the settings UI.
    category    TEXT NOT NULL,

    CONSTRAINT permissions_key_shape CHECK (key ~ '^[a-z]+(:[a-z-]+)+$')
);

CREATE TABLE role_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    role            user_role NOT NULL,
    permission_id   UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    -- TRUE  = grant on top of the coded default
    -- FALSE = explicit revoke
    granted         BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One ruling per (tenant, role, permission); a second would be ambiguous.
    CONSTRAINT role_permissions_unique UNIQUE (organization_id, role, permission_id)
);

-- Read once per session to build the override map.
CREATE INDEX role_permissions_org_role_idx ON role_permissions (organization_id, role);
