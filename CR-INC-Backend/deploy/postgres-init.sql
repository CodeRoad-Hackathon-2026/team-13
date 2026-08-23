-- One Postgres instance, two databases.
--
-- RAG Core and the orchestrator own genuinely different data — a document
-- corpus and an incident record — and neither should be able to migrate over
-- the other's tables. Separate databases keep that boundary without paying for
-- a second server in a stack meant to run on a laptop.
--
-- POSTGRES_DB creates incident_response; this adds the other one.
CREATE DATABASE rag OWNER incident;
