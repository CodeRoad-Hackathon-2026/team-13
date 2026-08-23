-- reset.sql
-- ============================================================================
-- DESTRUCTIVE. Drops every object created by db/migrations/, including all data.
-- Intended for local development only. Run with: ./db/migrate.sh --reset
-- ============================================================================

DROP VIEW IF EXISTS v_agent_performance CASCADE;
DROP VIEW IF EXISTS v_incident_timeline CASCADE;
DROP VIEW IF EXISTS v_known_vs_unknown_incidents CASCADE;
DROP VIEW IF EXISTS v_incidents_by_status CASCADE;
DROP VIEW IF EXISTS v_incidents_by_category CASCADE;
DROP VIEW IF EXISTS v_incidents_by_priority CASCADE;
DROP VIEW IF EXISTS v_incident_kpis CASCADE;

DROP TABLE IF EXISTS developer_feedback CASCADE;
DROP TABLE IF EXISTS similarity_matches CASCADE;
DROP TABLE IF EXISTS knowledge_embeddings CASCADE;
DROP TABLE IF EXISTS knowledge_documents CASCADE;
DROP TABLE IF EXISTS executed_actions CASCADE;
DROP TABLE IF EXISTS recommended_actions CASCADE;
DROP TABLE IF EXISTS agent_runs CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS incident_events CASCADE;
DROP TABLE IF EXISTS incidents CASCADE;
DROP TABLE IF EXISTS services CASCADE;

DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

DROP TYPE IF EXISTS knowledge_document_type;
DROP TYPE IF EXISTS feedback_type;
DROP TYPE IF EXISTS match_type;
DROP TYPE IF EXISTS execution_status;
DROP TYPE IF EXISTS risk_level;
DROP TYPE IF EXISTS action_status;
DROP TYPE IF EXISTS agent_run_status;
DROP TYPE IF EXISTS incident_priority;
DROP TYPE IF EXISTS incident_status;

-- Migration bookkeeping, so the next run replays everything from 001.
DROP TABLE IF EXISTS schema_migrations CASCADE;

-- Extensions are left installed on purpose; they are cheap and shared.
