-- 008_attendance_location_events.sql
--
-- The append-only log of every attendance action and the location evidence the
-- server used to decide it.
--
-- ─── Why this table exists separately ───────────────────────────────────────
-- `attendance_records` holds the *outcome* for a day. This holds every
-- *attempt*, including the refused ones — which is the whole point. A check-in
-- rejected for being 248 m outside the perimeter creates no attendance record,
-- but it does create a row here. Without that, repeated probing of the
-- boundary would be invisible.
--
-- ─── Append-only ────────────────────────────────────────────────────────────
-- Nothing in the application updates or deletes these rows. There is
-- deliberately no updated_at column: the absence of one is the signal.
--
-- ─── The trust boundary ─────────────────────────────────────────────────────
-- `latitude`, `longitude` and `accuracy_meters` are what the CLIENT claimed.
-- `distance_meters`, `verification` and `risk_flags` are what the SERVER
-- computed from that claim. The two are stored side by side precisely so a
-- reviewer can see both the assertion and the judgement.

CREATE TABLE attendance_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,

    -- Null for a refused attempt: there is no attendance record to attach to.
    attendance_record_id UUID REFERENCES attendance_records (id) ON DELETE CASCADE,

    office_id   UUID REFERENCES offices (id) ON DELETE SET NULL,
    geofence_id UUID REFERENCES office_geofences (id) ON DELETE SET NULL,

    type        attendance_event_type NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Claimed by the device.
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    accuracy_meters DOUBLE PRECISION,

    -- Computed by the server.
    distance_meters DOUBLE PRECISION,
    verification    location_verification NOT NULL DEFAULT 'NO_LOCATION',
    source          attendance_source NOT NULL DEFAULT 'WEB',
    -- Reason codes from the anti-spoofing checks, e.g. {IMPOSSIBLE_TRAVEL}.
    risk_flags      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    ip_address TEXT,
    user_agent TEXT,
    device_id  TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_events_latitude_range CHECK (
        latitude IS NULL OR latitude BETWEEN -90 AND 90
    ),
    CONSTRAINT attendance_events_longitude_range CHECK (
        longitude IS NULL OR longitude BETWEEN -180 AND 180
    ),
    CONSTRAINT attendance_events_accuracy_non_negative CHECK (
        accuracy_meters IS NULL OR accuracy_meters >= 0
    ),
    CONSTRAINT attendance_events_distance_non_negative CHECK (
        distance_meters IS NULL OR distance_meters >= 0
    ),
    -- Coordinates travel together or not at all; one without the other is a bug.
    CONSTRAINT attendance_events_coordinates_paired CHECK (
        (latitude IS NULL) = (longitude IS NULL)
    )
);

-- "What did this person do today?" and the impossible-travel lookup, which
-- reads the most recent VERIFIED fix for one employee.
CREATE INDEX attendance_events_org_employee_time_idx
    ON attendance_events (organization_id, employee_id, occurred_at DESC);

CREATE INDEX attendance_events_record_idx ON attendance_events (attendance_record_id);

-- The Location Review tab: recent refused or flagged attempts.
CREATE INDEX attendance_events_org_verification_idx
    ON attendance_events (organization_id, verification, occurred_at DESC);
