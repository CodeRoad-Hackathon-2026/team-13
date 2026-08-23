-- 006_agents_agent_runs.sql
-- Schema doc sections 5.1 and 5.2 — the AI orchestration layer.

CREATE TABLE IF NOT EXISTS agents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(255) NOT NULL UNIQUE,
    description  TEXT,
    version      VARCHAR(50) NOT NULL DEFAULT '1',
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id       UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    -- RESTRICT: agent history must stay attributable, so a referenced agent
    -- cannot be deleted. Deactivate it with is_active = FALSE instead.
    agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    status            agent_run_status NOT NULL DEFAULT 'RUNNING',
    input             JSONB,
    output            JSONB,
    confidence_score  NUMERIC(5, 4),
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ,
    error_message     TEXT,

    -- Optional metrics from the schema doc: cost, latency and prompt-version tracking.
    tokens_input      INTEGER,
    tokens_output     INTEGER,
    latency_ms        INTEGER,
    model             VARCHAR(100),
    prompt_version    VARCHAR(50),

    CONSTRAINT chk_agent_runs_confidence_score
        CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
    CONSTRAINT chk_agent_runs_finished_after_started
        CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_incident
    ON agent_runs(incident_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent  ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
