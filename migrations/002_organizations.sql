-- 002_organizations.sql
--
-- The tenant root. Every other tenant-owned table hangs off this one and
-- cascades from it, so deleting an organisation removes its data rather than
-- orphaning it.
--
-- Organisation-wide attendance policy lives here rather than in a separate
-- settings table: it is exactly one row per organisation, it is read on every
-- check-in, and splitting it out would buy a join and nothing else. Offices may
-- override the working window (see 003).

CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- URL-safe tenant key, e.g. "acme-technologies". Globally unique because
    -- it identifies the tenant itself.
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    legal_name  TEXT,
    logo_url    TEXT,
    plan        organization_plan NOT NULL DEFAULT 'GROWTH',

    timezone    TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    currency    TEXT NOT NULL DEFAULT 'INR',
    locale      TEXT NOT NULL DEFAULT 'en-IN',

    -- Working window, in minutes from local midnight. Integers rather than
    -- TIME because they are compared arithmetically against a computed
    -- minute-of-day, and because 09:00 has no meaning without a timezone.
    workday_start_minutes INTEGER NOT NULL DEFAULT 540,   -- 09:00
    workday_end_minutes   INTEGER NOT NULL DEFAULT 1080,  -- 18:00
    -- Minutes after the start before an arrival counts as late.
    grace_period_minutes  INTEGER NOT NULL DEFAULT 15,
    full_day_hours        NUMERIC(4,2) NOT NULL DEFAULT 8,
    half_day_hours        NUMERIC(4,2) NOT NULL DEFAULT 4,
    -- ISO weekday numbers (1 = Monday … 7 = Sunday) treated as weekend.
    weekend_days          SMALLINT[] NOT NULL DEFAULT ARRAY[6, 7]::SMALLINT[],

    -- Location policy. Read on every check-in.
    max_accuracy_meters       INTEGER NOT NULL DEFAULT 100,
    max_travel_speed_kmh      INTEGER NOT NULL DEFAULT 900,
    -- When false, an out-of-perimeter check-in is recorded and flagged rather
    -- than refused.
    enforce_geofence          BOOLEAN NOT NULL DEFAULT TRUE,
    allow_manual_override     BOOLEAN NOT NULL DEFAULT TRUE,
    require_checkout_location BOOLEAN NOT NULL DEFAULT FALSE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Soft delete: an organisation's history outlives its subscription.
    deleted_at  TIMESTAMPTZ,

    -- Invariants the application also checks, enforced here so a bug cannot
    -- write a nonsensical policy.
    CONSTRAINT organizations_workday_order CHECK (workday_end_minutes > workday_start_minutes),
    CONSTRAINT organizations_workday_bounds CHECK (
        workday_start_minutes BETWEEN 0 AND 1439 AND workday_end_minutes BETWEEN 1 AND 1440
    ),
    CONSTRAINT organizations_grace_bounds CHECK (grace_period_minutes BETWEEN 0 AND 240),
    CONSTRAINT organizations_half_day_shorter CHECK (half_day_hours < full_day_hours),
    CONSTRAINT organizations_accuracy_bounds CHECK (max_accuracy_meters BETWEEN 20 AND 1000),
    CONSTRAINT organizations_speed_bounds CHECK (max_travel_speed_kmh BETWEEN 50 AND 2000),
    CONSTRAINT organizations_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TRIGGER organizations_set_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Live-tenant lookups filter on deleted_at constantly.
CREATE INDEX organizations_deleted_at_idx ON organizations (deleted_at);
