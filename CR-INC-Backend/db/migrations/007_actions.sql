-- 007_actions.sql
-- Schema doc sections 6.1 and 6.2 — recommendation stays separate from execution,
-- so one approved recommendation can have several execution attempts (incl. rollback).
--
-- action_type is VARCHAR, not an enum: it maps to whatever MCP tool is registered
-- (SQL, LAMBDA, API, GITHUB_PR, KUBERNETES, ...) and that list keeps growing.

CREATE TABLE IF NOT EXISTS recommended_actions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id       UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    agent_run_id      UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    action_type       VARCHAR(64) NOT NULL,
    description       TEXT,
    parameters        JSONB NOT NULL DEFAULT '{}'::jsonb,
    risk_level        risk_level NOT NULL DEFAULT 'MEDIUM',
    confidence_score  NUMERIC(5, 4),
    approval_required BOOLEAN NOT NULL DEFAULT TRUE,
    approved_by       VARCHAR(255),
    approved_at       TIMESTAMPTZ,
    status            action_status NOT NULL DEFAULT 'PROPOSED',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_recommended_actions_confidence_score
        CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
    -- An approval is a who + a when, never one without the other.
    CONSTRAINT chk_recommended_actions_approval_pair
        CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

DROP TRIGGER IF EXISTS trg_recommended_actions_updated_at ON recommended_actions;
CREATE TRIGGER trg_recommended_actions_updated_at
    BEFORE UPDATE ON recommended_actions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_recommended_actions_incident
    ON recommended_actions(incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommended_actions_agent_run
    ON recommended_actions(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_recommended_actions_status
    ON recommended_actions(status);
-- The approval queue on the dashboard.
CREATE INDEX IF NOT EXISTS idx_recommended_actions_pending_approval
    ON recommended_actions(created_at DESC)
    WHERE status = 'PROPOSED' AND approval_required;

CREATE TABLE IF NOT EXISTS executed_actions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommended_action_id  UUID NOT NULL REFERENCES recommended_actions(id) ON DELETE CASCADE,
    started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at            TIMESTAMPTZ,
    status                 execution_status NOT NULL DEFAULT 'RUNNING',
    request_payload        JSONB,
    response_payload       JSONB,
    execution_logs         TEXT,
    error_message          TEXT,
    executed_by            VARCHAR(255),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_executed_actions_finished_after_started
        CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_executed_actions_recommended_action
    ON executed_actions(recommended_action_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_executed_actions_status
    ON executed_actions(status);
