-- 014_agent_policy.sql
-- Who decides whether a human sees an agent's work.
--
-- Until now, nobody did. app/agents/decision.py wrote approval_required as the
-- literal TRUE in its INSERT, so the risk_level the model was asked to assign
-- was stored and then read by nothing that decides anything — no proposal could
-- auto-run at any risk level, and the read side's extensive support for
-- approval_required = FALSE was exercised only by seed data.
--
-- These four tables are the input to app/agents/policy.py, which answers that
-- question once, in one place, for a reason it can state.

-- ---------------------------------------------------------------- autonomy
-- How far this agent may go before a human is involved. A ceiling: the per-risk
-- policy below can be more cautious than the level allows, never less.
--
--   observe            — runs and records its reasoning, proposes nothing
--   suggest            — proposes, and everything waits for a person
--   act_with_approval  — the per-risk policy decides
--   act_autonomously   — everything runs, subject to the guardrails
--
-- VARCHAR with a CHECK rather than an enum, following 002_enums.sql:4-6: this is
-- a list that grows as the system grows, and adding a value to an enum in
-- Postgres is a migration that cannot run inside a transaction.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy VARCHAR(32) NOT NULL
    DEFAULT 'act_with_approval';

DO $$
BEGIN
    ALTER TABLE agents ADD CONSTRAINT chk_agents_autonomy
        CHECK (autonomy IN ('observe', 'suggest', 'act_with_approval', 'act_autonomously'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
CREATE TRIGGER trg_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------- risk policy
-- One row per (agent, risk level). Three rows per agent, so a level with no row
-- is a bug rather than an implicit default — an absent policy that silently
-- meant "ask" would be indistinguishable from an operator who chose "ask", and
-- only one of those is a decision somebody made.
CREATE TABLE IF NOT EXISTS agent_risk_policy (
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    risk_level  risk_level NOT NULL,
    disposition VARCHAR(16) NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (agent_id, risk_level),
    -- never — the action is not even proposed. Distinct from ask_first, which
    -- proposes and waits: "never" is a standing decision, not a pending one.
    CONSTRAINT chk_agent_risk_policy_disposition
        CHECK (disposition IN ('auto_run', 'ask_first', 'never'))
);

DROP TRIGGER IF EXISTS trg_agent_risk_policy_updated_at ON agent_risk_policy;
CREATE TRIGGER trg_agent_risk_policy_updated_at
    BEFORE UPDATE ON agent_risk_policy
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------- skills
-- A named remediation this agent is allowed to reach for. The catalogue an
-- operator reads, keyed to the things the executor can actually carry out.
--
-- action_type is VARCHAR for the reason 007_actions.sql:5-6 already gives — it
-- maps to whatever tool is registered, and that list keeps growing.
CREATE TABLE IF NOT EXISTS agent_skills (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name         VARCHAR(255) NOT NULL,
    description  TEXT,
    action_type  VARCHAR(64) NOT NULL,
    risk_level   risk_level NOT NULL DEFAULT 'MEDIUM',
    -- NULL means the skill is not bound to one service. Kept nullable rather
    -- than defaulted so "any service" is expressible.
    service_id   UUID REFERENCES services(id) ON DELETE SET NULL,
    environments TEXT[] NOT NULL DEFAULT '{}',
    enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (agent_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_lookup
    ON agent_skills(agent_id, action_type, service_id);

DROP TRIGGER IF EXISTS trg_agent_skills_updated_at ON agent_skills;
CREATE TRIGGER trg_agent_skills_updated_at
    BEFORE UPDATE ON agent_skills
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------- guardrails
-- One row, enforced by the primary key. These bound what *every* agent may do,
-- so they belong to the orchestrator rather than to any one agent — an operator
-- who sets a blackout window means the system, not the Decision Agent.
CREATE TABLE IF NOT EXISTS orchestrator_guardrails (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE,

    -- Counted against executions already RUNNING. At the ceiling, an auto_run
    -- proposal is downgraded to ask_first rather than dropped: the incident is
    -- real either way, and a queue nobody can see is worse than a decision
    -- somebody has to make.
    max_concurrent_executions INT NOT NULL DEFAULT 2,

    -- A weekly window that may span midnight and the weekend, like "Fri 16:00 —
    -- Mon 06:00". ISO day of week, 1 = Monday, matching EXTRACT(ISODOW).
    -- All four NULL means no window.
    blackout_start_dow  INT,
    blackout_start_time TIME,
    blackout_end_dow    INT,
    blackout_end_time   TIME,

    -- Service names, not ids: an operator writes "billing-core" before that
    -- service has a row, and a guardrail that only protects services already
    -- registered protects the wrong set. Matched case-insensitively in Python.
    never_touch_services TEXT[] NOT NULL DEFAULT '{}',

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_orchestrator_guardrails_singleton CHECK (id),
    CONSTRAINT chk_orchestrator_guardrails_concurrency
        CHECK (max_concurrent_executions > 0),
    CONSTRAINT chk_orchestrator_guardrails_dow
        CHECK ((blackout_start_dow IS NULL OR blackout_start_dow BETWEEN 1 AND 7)
           AND (blackout_end_dow   IS NULL OR blackout_end_dow   BETWEEN 1 AND 7)),
    -- A window is all four columns or none of them. Two of four would be a
    -- window whose meaning depends on which two.
    CONSTRAINT chk_orchestrator_guardrails_window_complete
        CHECK (
            (blackout_start_dow IS NULL AND blackout_start_time IS NULL
             AND blackout_end_dow IS NULL AND blackout_end_time IS NULL)
            OR
            (blackout_start_dow IS NOT NULL AND blackout_start_time IS NOT NULL
             AND blackout_end_dow IS NOT NULL AND blackout_end_time IS NOT NULL)
        )
);

DROP TRIGGER IF EXISTS trg_orchestrator_guardrails_updated_at ON orchestrator_guardrails;
CREATE TRIGGER trg_orchestrator_guardrails_updated_at
    BEFORE UPDATE ON orchestrator_guardrails
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- Supabase
-- 013_supabase_rls.sql enables RLS on every table in `public` that lacks it,
-- and its own comment hopes migration 014 will "come back here". Numbering
-- cannot deliver that: migrations run once each, tracked by filename, so on a
-- database where 013 has already been applied it will never see these three
-- tables. Without this block they would be readable and writable by anyone
-- holding the project's anon key — a key that ships inside a browser bundle —
-- and one of them is the table that decides whether a remediation needs a human.
--
-- So the rule is that a migration creating a table enables RLS on it, here,
-- rather than trusting a later one to notice. Zero policies means anon and
-- authenticated see no rows; the orchestrator connects as the owner and an owner
-- bypasses RLS, which is why FORCE ROW LEVEL SECURITY is deliberately not used.
-- Harmless on plain PostgreSQL, where those roles do not exist.
ALTER TABLE agent_risk_policy        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_skills             ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrator_guardrails  ENABLE ROW LEVEL SECURITY;
