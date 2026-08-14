-- 012_notifications.sql
--
-- In-app, email and push notifications.
--
-- `sent_at` is the honest field here. An IN_APP row is delivered the moment it
-- is written — it lives in the database the UI reads. EMAIL and PUSH rows are
-- created with sent_at NULL and stay that way until a provider actually
-- accepts them. With no provider configured, they remain pending rather than
-- being marked sent, because a dashboard claiming "leave request emailed" when
-- no mail server exists is worse than one that says nothing.
--
-- A future transport worker picks up its queue with:
--   SELECT … WHERE channel <> 'IN_APP' AND sent_at IS NULL

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    type    notification_type    NOT NULL,
    channel notification_channel NOT NULL DEFAULT 'IN_APP',
    title   TEXT NOT NULL,
    body    TEXT NOT NULL,
    -- In-app deep link, e.g. "/app/tasks/<id>". Relative by design: an
    -- absolute URL would bake the deployment's hostname into a stored row.
    link_url TEXT,

    read_at TIMESTAMPTZ,
    -- Set only once a transport has accepted the message.
    sent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT notifications_link_is_relative CHECK (
        link_url IS NULL OR link_url LIKE '/%'
    )
);

-- The unread badge and the notification list, in one index.
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, read_at, created_at DESC);
CREATE INDEX notifications_org_time_idx ON notifications (organization_id, created_at DESC);

-- The pending-delivery queue for a future email/push worker. Partial, so it
-- stays small: it indexes only what has not been sent.
CREATE INDEX notifications_pending_delivery_idx
    ON notifications (channel, created_at)
    WHERE channel <> 'IN_APP' AND sent_at IS NULL;
