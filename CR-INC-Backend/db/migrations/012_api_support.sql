-- 012_api_support.sql
-- What the dashboard API needs that the MVP schema did not anticipate.
--
-- Three unrelated-looking changes, one cause: every one of them is a query the
-- dashboard makes that the schema could not answer.

-- 1. Which action a piece of feedback judges.
--
-- POST /api/actions/:id/reject writes a developer_feedback row *for that action*
-- (AR-6), but feedback could only point at an incident or an agent run. Routing
-- through recommended_actions.agent_run_id loses the distinction whenever one
-- run proposed several actions.
--
-- Nullable: feedback submitted from the incident drawer judges the incident's
-- classification, not any particular action, and must stay legal.
ALTER TABLE developer_feedback
    ADD COLUMN IF NOT EXISTS recommended_action_id UUID
        REFERENCES recommended_actions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_developer_feedback_recommended_action
    ON developer_feedback(recommended_action_id);

-- 2. Which service a knowledge document covers.
--
-- The Knowledge tab reports how many services have a runbook. Without this link
-- there is no way to ask the question at all.
--
-- SET NULL rather than CASCADE, matching knowledge_documents.incident_id: a
-- runbook outlives the service registration it was written against.
ALTER TABLE knowledge_documents
    ADD COLUMN IF NOT EXISTS service_id UUID
        REFERENCES services(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_service
    ON knowledge_documents(service_id);

-- 3. Indexes for the columns the dashboard filters and sorts by.
--
-- environment is the single most-used filter in the UI — it is on the incident
-- list and on every dashboard endpoint — and had no index at all.
CREATE INDEX IF NOT EXISTS idx_incidents_environment ON incidents(environment);

-- Partial: the "unassigned" tile only ever asks for the NULL side, so indexing
-- the assigned rows would be dead weight.
CREATE INDEX IF NOT EXISTS idx_incidents_unassigned
    ON incidents(created_at DESC) WHERE assigned_to IS NULL;

-- Every resolution-time metric filters on resolved_at IS NOT NULL.
CREATE INDEX IF NOT EXISTS idx_incidents_resolved_at
    ON incidents(resolved_at) WHERE resolved_at IS NOT NULL;

-- sort=confidence on the incident list.
CREATE INDEX IF NOT EXISTS idx_incidents_confidence_score
    ON incidents(confidence_score DESC NULLS LAST);

-- Outcomes and agent health are both time-ranged. The existing composites lead
-- with a foreign key, so neither can serve a bare range scan.
CREATE INDEX IF NOT EXISTS idx_executed_actions_started_at ON executed_actions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at       ON agent_runs(started_at DESC);
