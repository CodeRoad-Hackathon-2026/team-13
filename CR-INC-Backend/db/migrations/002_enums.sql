-- 002_enums.sql
-- Enum types for the bounded state machines (schema doc section 12).
--
-- Only genuinely closed sets are enums. Values that grow as the system grows
-- (incident category, incident source, event_type, action_type) stay VARCHAR so a
-- new agent or MCP tool does not need a migration to emit a new value.
--
-- To add a value later:  ALTER TYPE incident_status ADD VALUE 'SUPPRESSED';

DO $$ BEGIN
    CREATE TYPE incident_status AS ENUM (
        'OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED', 'ESCALATED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE incident_priority AS ENUM ('P1', 'P2', 'P3', 'P4');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE agent_run_status AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE action_status AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE risk_level AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE execution_status AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'ROLLED_BACK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE match_type AS ENUM ('SEMANTIC', 'EXACT', 'CATEGORY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE feedback_type AS ENUM ('APPROVED', 'REJECTED', 'CORRECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE knowledge_document_type AS ENUM (
        'INCIDENT', 'RUNBOOK', 'POSTMORTEM', 'GITHUB_ISSUE', 'GITHUB_PR',
        'DOCUMENTATION', 'EMAIL', 'TROUBLESHOOTING_GUIDE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
