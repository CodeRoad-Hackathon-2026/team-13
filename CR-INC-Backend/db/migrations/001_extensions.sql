-- 001_extensions.sql
-- PostgreSQL extensions required by the AI Incident Response Orchestrator.
-- Requires PostgreSQL 13+ (gen_random_uuid() is built in from 13 onwards).

-- Kept for compatibility with code that calls uuid_generate_v4();
-- the DDL in this project uses the built-in gen_random_uuid() instead.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgvector: embeddings + HNSW index for semantic retrieval (requires pgvector >= 0.5.0).
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigram text similarity, used for fuzzy title search alongside vector similarity.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
