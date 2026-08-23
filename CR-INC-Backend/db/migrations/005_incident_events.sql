-- 005_incident_events.sql
-- Schema doc section 4.1 — the append-only audit timeline behind the dashboard.
--
-- event_type is deliberately VARCHAR, not an enum: agents add new event types often
-- and an append-only log should never reject a write. Recommended values:
--   INCIDENT_CREATED, EMAIL_RECEIVED, INCIDENT_CLASSIFIED, RAG_SEARCH_STARTED,
--   RAG_SEARCH_COMPLETED, SIMILAR_INCIDENT_FOUND, ACTION_RECOMMENDED, ACTION_APPROVED,
--   ACTION_REJECTED, ACTION_EXECUTED, VALIDATION_STARTED, VALIDATION_PASSED,
--   VALIDATION_FAILED, DEVELOPER_NOTIFIED, ESCALATED, RESOLVED, CLOSED

CREATE TABLE IF NOT EXISTS incident_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id  UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    event_type   VARCHAR(64) NOT NULL,
    description  TEXT,
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   VARCHAR(255)
);

-- Timeline read pattern: all events for one incident, oldest first.
CREATE INDEX IF NOT EXISTS idx_incident_events_incident
    ON incident_events(incident_id, created_at);

CREATE INDEX IF NOT EXISTS idx_incident_events_type
    ON incident_events(event_type);

-- Containment queries over structured event data, e.g. payload @> '{"lambda":"..."}'.
CREATE INDEX IF NOT EXISTS idx_incident_events_payload
    ON incident_events USING gin (payload jsonb_path_ops);
