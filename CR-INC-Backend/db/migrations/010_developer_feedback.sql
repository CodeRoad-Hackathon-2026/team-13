-- 010_developer_feedback.sql
-- Schema doc section 9.1 — human decisions on AI output; the training signal for
-- the future evaluation loop, so corrections are stored as data, not as edits.

CREATE TABLE IF NOT EXISTS developer_feedback (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id           UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    agent_run_id          UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    feedback_type         feedback_type NOT NULL,
    comments              TEXT,
    corrected_category    VARCHAR(100),
    corrected_priority    incident_priority,
    corrected_resolution  TEXT,
    created_by            VARCHAR(255),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_developer_feedback_incident
    ON developer_feedback(incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_developer_feedback_agent_run
    ON developer_feedback(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_developer_feedback_type
    ON developer_feedback(feedback_type);
