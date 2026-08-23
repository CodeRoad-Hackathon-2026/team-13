-- Setup surface: an encrypted secret vault, versioned prompts, cron run
-- history, and pinned traces.
--
-- Applied over a live database by db.run_migrations(), so every statement is
-- IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

-- ------------------------------------------------------------------ secrets
-- Connector tokens pasted through the UI. Only the ciphertext is stored; the
-- key lives in SECRETS_KEY in the worker/API environment, so a database dump
-- on its own does not disclose a single vendor token.
--
-- `hint` is the last four characters in clear. It is what makes a secret
-- identifiable in the UI ("...4f2a") without an endpoint that can return the
-- plaintext — once written, a secret is write-only from the outside.
CREATE TABLE IF NOT EXISTS secrets (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT NOT NULL UNIQUE
                 CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),
    description  TEXT,
    ciphertext   BYTEA NOT NULL,
    nonce        BYTEA NOT NULL,
    hint         TEXT NOT NULL DEFAULT '',
    -- Key fingerprint. If SECRETS_KEY is rotated, rows written under the old
    -- key decrypt to garbage; comparing fingerprints turns that into a clear
    -- "encrypted with a different key" error instead of a corrupt token.
    key_id       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

-- ------------------------------------------------------------------ prompts
-- A prompt is addressed by (key, collection). collection_id NULL is the global
-- default; a row with a collection overrides it for that collection only.
CREATE TABLE IF NOT EXISTS prompts (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key           TEXT NOT NULL,
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
    description   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NULLS NOT DISTINCT (PG15+) makes the global row unique on its own; without
-- it two global rows for the same key would both be allowed, and which one won
-- would depend on row order.
CREATE UNIQUE INDEX IF NOT EXISTS prompts_key_scope_idx
    ON prompts (key, collection_id) NULLS NOT DISTINCT;

-- Immutable once written: a trace points at the version that produced it, so
-- editing a version in place would silently rewrite history.
CREATE TABLE IF NOT EXISTS prompt_versions (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_id  UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    body       TEXT NOT NULL,
    note       TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (prompt_id, version)
);

-- Exactly one active version per prompt, enforced by the index rather than by
-- application code that has to remember to deactivate the previous one.
ALTER TABLE prompt_versions
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS prompt_versions_active_idx
    ON prompt_versions (prompt_id) WHERE is_active;

-- --------------------------------------------------------------- source runs
-- sources.last_status is overwritten on every poll, so an intermittent failure
-- is invisible five minutes later. This keeps each attempt.
CREATE TABLE IF NOT EXISTS source_runs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id    UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    trigger      TEXT NOT NULL DEFAULT 'schedule',  -- schedule | manual
    status       TEXT NOT NULL DEFAULT 'running',   -- running | ok | error
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    duration_ms  INTEGER,
    documents    INTEGER NOT NULL DEFAULT 0,
    indexed      INTEGER NOT NULL DEFAULT 0,
    unchanged    INTEGER NOT NULL DEFAULT 0,
    failed       INTEGER NOT NULL DEFAULT 0,
    error        TEXT
);

CREATE INDEX IF NOT EXISTS source_runs_source_started_idx
    ON source_runs (source_id, started_at DESC);

-- ------------------------------------------------------------ pinned traces
-- A merged PR lives in git forever; prune_logs deletes query_logs after 30
-- days. A pinned trace is excluded from pruning so the "why did the agent do
-- this" link in a PR body does not 404 a month later.
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS pinned     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS pinned_at  TIMESTAMPTZ;
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS pin_reason TEXT;

-- Which prompt produced this answer. Without it, editing a prompt makes every
-- past trace unexplainable — the answer no longer matches what the current
-- prompt would produce, and nothing records why.
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS prompt_versions JSONB
    NOT NULL DEFAULT '{}'::jsonb;

-- prune_logs scans by created_at and skips pinned rows.
CREATE INDEX IF NOT EXISTS query_logs_prune_idx
    ON query_logs (created_at) WHERE NOT pinned;

-- Retrieving everything that happened during one incident is the query the
-- orchestrator app makes; without this it is a sequential scan.
CREATE INDEX IF NOT EXISTS query_logs_incident_idx
    ON query_logs (incident_id, created_at DESC) WHERE incident_id IS NOT NULL;
