-- RAG core schema.
-- __EMBEDDING_DIM__ is substituted at migration time from settings.embedding_dim.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------- collections
-- A collection is the isolation unit: one embedding model, one logical corpus
-- (runbooks, incidents, slack, aws-logs, sql-repos, ...).
CREATE TABLE IF NOT EXISTS collections (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name           TEXT NOT NULL UNIQUE,
    description    TEXT,
    embedding_model TEXT NOT NULL,
    embedding_dim  INTEGER NOT NULL,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------- documents
CREATE TABLE IF NOT EXISTS documents (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    -- Stable id in the origin system (jira key, slack ts, s3 key, file path).
    -- Re-ingesting the same external_id replaces the document in place.
    external_id   TEXT NOT NULL,
    source_type   TEXT NOT NULL DEFAULT 'api',
    uri           TEXT,
    title         TEXT,
    -- The original body, kept verbatim. Chunk text is lossy (heading paths are
    -- prepended, windows overlap), so re-embedding after a model change must
    -- re-chunk from this, not from the stored chunks.
    raw_content   TEXT,
    content_hash  TEXT NOT NULL,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending|indexed|failed
    error         TEXT,
    chunk_count   INTEGER NOT NULL DEFAULT 0,
    -- Freshness signals used by the ranker to prefer recent incidents.
    source_created_at TIMESTAMPTZ,
    source_updated_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (collection_id, external_id)
);

CREATE INDEX IF NOT EXISTS documents_collection_idx ON documents (collection_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_metadata_idx   ON documents USING gin (metadata jsonb_path_ops);
CREATE INDEX IF NOT EXISTS documents_hash_idx       ON documents (collection_id, content_hash);

-- -------------------------------------------------------------------- chunks
CREATE TABLE IF NOT EXISTS chunks (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    ordinal       INTEGER NOT NULL,
    content       TEXT NOT NULL,
    -- Heading path / preceding context kept separately so it can be shown to
    -- the model without polluting the embedded text.
    context       TEXT,
    token_count   INTEGER NOT NULL DEFAULT 0,
    embedding     VECTOR(__EMBEDDING_DIM__),
    -- Document metadata is merged into chunk metadata at ingest time so a single
    -- containment filter (`metadata @> ...`) covers both levels.
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    tsv           TSVECTOR GENERATED ALWAYS AS (to_tsvector('__FTS_CONFIG__', content)) STORED,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, ordinal)
);

CREATE INDEX IF NOT EXISTS chunks_tsv_idx        ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_metadata_idx   ON chunks USING gin (metadata jsonb_path_ops);
CREATE INDEX IF NOT EXISTS chunks_collection_idx ON chunks (collection_id);
CREATE INDEX IF NOT EXISTS chunks_trgm_idx       ON chunks USING gin (content gin_trgm_ops);

-- HNSW beats IVFFlat here: no training step, and recall stays high as the
-- corpus grows during a live demo.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ------------------------------------------------------------------- sources
-- A source is a pull-based feed the scheduler polls on a cron expression.
CREATE TABLE IF NOT EXISTS sources (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,                      -- filesystem|http_json
    config        JSONB NOT NULL DEFAULT '{}'::jsonb,
    interval_seconds INTEGER NOT NULL DEFAULT 3600,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    -- Incremental pointer (updated_at watermark, offset, ETag, ...).
    cursor        JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_run_at   TIMESTAMPTZ,
    last_status   TEXT,
    last_error    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (collection_id, name)
);

CREATE INDEX IF NOT EXISTS sources_due_idx ON sources (enabled, last_run_at);

-- ------------------------------------------------------------ ingestion jobs
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
    document_id   UUID REFERENCES documents(id) ON DELETE SET NULL,
    source_id     UUID REFERENCES sources(id) ON DELETE SET NULL,
    kind          TEXT NOT NULL,                      -- document|source_sync|reembed
    status        TEXT NOT NULL DEFAULT 'queued',     -- queued|running|succeeded|failed
    attempts      INTEGER NOT NULL DEFAULT 0,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    result        JSONB,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ingestion_jobs_status_idx ON ingestion_jobs (status, created_at DESC);

-- ------------------------------------------------------------------ api keys
CREATE TABLE IF NOT EXISTS api_keys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,                 -- sha256 of the raw key
    key_prefix  TEXT NOT NULL,                        -- first 8 chars, for display
    scopes      TEXT[] NOT NULL DEFAULT ARRAY['read'],
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 120,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------- query logs
-- Full trace of every retrieval + generation. This is both the audit trail and
-- the training signal for the feedback loop.
CREATE TABLE IF NOT EXISTS query_logs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id    UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    agent_id      TEXT,
    incident_id   TEXT,
    query         TEXT NOT NULL,
    collections   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    filters       JSONB NOT NULL DEFAULT '{}'::jsonb,
    retrieved     JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{chunk_id, scores...}]
    answer        TEXT,
    citations     JSONB NOT NULL DEFAULT '[]'::jsonb,
    abstained     BOOLEAN NOT NULL DEFAULT false,
    abstain_reason TEXT,
    groundedness  JSONB,
    llm_model     TEXT,
    embedding_model TEXT,
    latency_ms    INTEGER,
    usage         JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS query_logs_created_idx  ON query_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS query_logs_incident_idx ON query_logs (incident_id) WHERE incident_id IS NOT NULL;

-- ------------------------------------------------------------------ feedback
-- Agents mark whether a retrieved chunk actually helped resolve the incident.
CREATE TABLE IF NOT EXISTS feedback (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_log_id UUID REFERENCES query_logs(id) ON DELETE CASCADE,
    chunk_id     UUID REFERENCES chunks(id) ON DELETE CASCADE,
    document_id  UUID REFERENCES documents(id) ON DELETE CASCADE,
    rating       SMALLINT NOT NULL,                   -- -1 | 0 | +1
    reason       TEXT,
    agent_id     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (rating BETWEEN -1 AND 1)
);

CREATE INDEX IF NOT EXISTS feedback_chunk_idx ON feedback (chunk_id);

-- Aggregated per-chunk quality signal, folded into the final ranking score.
CREATE OR REPLACE VIEW chunk_feedback_scores AS
SELECT chunk_id,
       SUM(rating)::float / GREATEST(COUNT(*), 1) AS avg_rating,
       COUNT(*)                                   AS vote_count
FROM feedback
WHERE chunk_id IS NOT NULL
GROUP BY chunk_id;

-- ------------------------------------------------------------- async answers
-- Backing store for the webhook-callback flow (POST /answer with callback_url).
CREATE TABLE IF NOT EXISTS async_answers (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status       TEXT NOT NULL DEFAULT 'queued',      -- queued|running|succeeded|failed
    request      JSONB NOT NULL,
    callback_url TEXT NOT NULL,
    response     JSONB,
    error        TEXT,
    delivered_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
