-- 008_knowledge.sql
-- Schema doc sections 7.1 and 7.2 — the RAG corpus and its vector index.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ EMBEDDING DIMENSION: vector(1536) below must match the embedding model.  │
-- │   1536 → OpenAI text-embedding-3-small / ada-002                         │
-- │   1024 → Amazon Titan Text Embeddings V2, Cohere embed-english-v3        │
-- │   3072 → OpenAI text-embedding-3-large                                   │
-- │ Changing it later means rewriting the column and re-embedding everything, │
-- │ so pick the model before loading the corpus.                             │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title          VARCHAR(500) NOT NULL,
    summary        TEXT,
    content        TEXT,
    document_type  knowledge_document_type NOT NULL,
    source         VARCHAR(100),
    source_url     TEXT,
    source_id      VARCHAR(255),
    -- SET NULL, not CASCADE: knowledge outlives the incident that produced it.
    incident_id    UUID REFERENCES incidents(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_knowledge_documents_updated_at ON knowledge_documents;
CREATE TRIGGER trg_knowledge_documents_updated_at
    BEFORE UPDATE ON knowledge_documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_type
    ON knowledge_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_incident
    ON knowledge_documents(incident_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_title_trgm
    ON knowledge_documents USING gin (title gin_trgm_ops);

-- Re-ingesting the same runbook / GitHub issue updates it instead of duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_documents_source_id
    ON knowledge_documents(source, source_id)
    WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_document_id  UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    chunk_index            INTEGER NOT NULL,
    content                TEXT NOT NULL,
    embedding              VECTOR(1536) NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_knowledge_embeddings_chunk_index CHECK (chunk_index >= 0),
    -- Re-chunking a document cannot silently produce two chunk 0s.
    CONSTRAINT uq_knowledge_embeddings_document_chunk
        UNIQUE (knowledge_document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_document
    ON knowledge_embeddings(knowledge_document_id);

-- Cosine distance (<=>) index. Must match the operator the retrieval query uses:
--   SELECT ... ORDER BY embedding <=> $1 LIMIT 5;
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_vector
    ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops);
