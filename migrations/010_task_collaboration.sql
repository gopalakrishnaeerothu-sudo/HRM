-- 010_task_collaboration.sql
--
-- Comments, attachments and the activity timeline that makes a task's history
-- reconstructable.
--
-- All three carry organization_id even though it is reachable through
-- `tasks`. That denormalisation is deliberate: the tenant filter is applied on
-- every single read, and requiring a join to `tasks` just to know which tenant
-- a comment belongs to would make the cheapest guarantee in the system the
-- most expensive one.

CREATE TABLE task_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    -- SET NULL, not CASCADE: removing an employee must not silently delete the
    -- discussion that explains why a task went the way it did.
    author_id       UUID REFERENCES employees (id) ON DELETE SET NULL,

    body TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT task_comments_body_not_blank CHECK (length(btrim(body)) > 0)
);

CREATE TRIGGER task_comments_set_updated_at
    BEFORE UPDATE ON task_comments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX task_comments_task_time_idx ON task_comments (task_id, created_at);
CREATE INDEX task_comments_org_idx ON task_comments (organization_id);

-- ---------------------------------------------------------------------------
-- Attachments
--
-- Metadata only. The bytes live in object storage, addressed by storage_key.
-- Blobs in PostgreSQL bloat every backup and slow every restore, and put file
-- traffic through a connection pool that exists for queries.
-- ---------------------------------------------------------------------------

CREATE TABLE task_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    uploader_id     UUID REFERENCES employees (id) ON DELETE SET NULL,

    file_name   TEXT NOT NULL,
    file_size   BIGINT NOT NULL,
    mime_type   TEXT NOT NULL,
    storage_key TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT task_attachments_size_non_negative CHECK (file_size >= 0)
);

CREATE INDEX task_attachments_task_idx ON task_attachments (task_id);
CREATE INDEX task_attachments_org_idx ON task_attachments (organization_id);

-- ---------------------------------------------------------------------------
-- Activity timeline
--
-- Append-only, like attendance_events. The task detail page reads this rather
-- than inferring history from the current row, so "who moved this to blocked
-- and when" has an answer.
-- ---------------------------------------------------------------------------

CREATE TABLE task_activity (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    actor_id        UUID REFERENCES employees (id) ON DELETE SET NULL,

    type       task_activity_type NOT NULL,
    -- Human-readable summary rendered directly on the timeline.
    message    TEXT NOT NULL,
    from_value TEXT,
    to_value   TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX task_activity_task_time_idx ON task_activity (task_id, created_at DESC);
CREATE INDEX task_activity_org_time_idx ON task_activity (organization_id, created_at DESC);
