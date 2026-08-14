-- 003_offices_and_geofences.sql
--
-- Physical sites and the perimeters attendance is verified against.
--
-- Offices come before employees because an employee references their primary
-- office. Geofences are a separate table rather than columns on `offices` so
-- that one site can have several zones (main gate, annexe, car park), and so
-- that a radius change is an isolated, auditable row edit.
--
-- Coordinates are DOUBLE PRECISION, not NUMERIC. Double gives roughly
-- sub-millimetre resolution at these latitudes — orders of magnitude finer
-- than consumer GPS — and is what the trigonometric distance calculation
-- consumes without conversion. PostGIS is deliberately not used: see
-- docs/ARCHITECTURE.md for the reasoning.

CREATE TABLE offices (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

    name         TEXT NOT NULL,
    code         TEXT NOT NULL,
    address_line TEXT NOT NULL,
    city         TEXT NOT NULL,
    state        TEXT,
    country      TEXT NOT NULL DEFAULT 'India',
    postal_code  TEXT,
    -- IANA name. Decides which calendar day a check-in belongs to, so it is
    -- per office rather than per organisation.
    timezone     TEXT NOT NULL DEFAULT 'Asia/Kolkata',

    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,

    -- This office's local working window, overriding the organisation default.
    workday_start_minutes INTEGER NOT NULL DEFAULT 540,
    workday_end_minutes   INTEGER NOT NULL DEFAULT 1080,
    grace_period_minutes  INTEGER NOT NULL DEFAULT 15,

    status     office_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    -- Unique per tenant, not globally: two companies may both have an "HQ".
    CONSTRAINT offices_code_unique_per_org UNIQUE (organization_id, code),

    CONSTRAINT offices_latitude_range CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT offices_longitude_range CHECK (longitude BETWEEN -180 AND 180),
    -- (0, 0) is in the Gulf of Guinea and is almost always an uninitialised
    -- value rather than a real office.
    CONSTRAINT offices_not_null_island CHECK (NOT (latitude = 0 AND longitude = 0)),
    CONSTRAINT offices_workday_order CHECK (workday_end_minutes > workday_start_minutes),
    CONSTRAINT offices_grace_bounds CHECK (grace_period_minutes BETWEEN 0 AND 240)
);

CREATE TRIGGER offices_set_updated_at
    BEFORE UPDATE ON offices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX offices_org_status_idx ON offices (organization_id, status, deleted_at);

-- ---------------------------------------------------------------------------
-- Geofence zones
--
-- A circular perimeter around a point. The centre is stored per zone rather
-- than inherited from the office, so an annexe zone can sit somewhere else on
-- the site.
-- ---------------------------------------------------------------------------

CREATE TABLE office_geofences (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES offices (id) ON DELETE CASCADE,

    name          TEXT NOT NULL DEFAULT 'Main perimeter',
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 100,

    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT office_geofences_latitude_range CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT office_geofences_longitude_range CHECK (longitude BETWEEN -180 AND 180),
    -- The lower bound is not arbitrary: consumer GPS is rarely better than
    -- ~10 m, so a radius below 20 m would reject people at their own desk.
    CONSTRAINT office_geofences_radius_bounds CHECK (radius_meters BETWEEN 20 AND 5000)
);

CREATE TRIGGER office_geofences_set_updated_at
    BEFORE UPDATE ON office_geofences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX office_geofences_office_active_idx ON office_geofences (office_id, is_active);

-- At most one primary zone per office. A partial unique index expresses this
-- exactly; the application's "clear the flag on the others" step is then a
-- convenience rather than the thing keeping the invariant true.
CREATE UNIQUE INDEX office_geofences_one_primary_per_office
    ON office_geofences (office_id)
    WHERE is_primary;
