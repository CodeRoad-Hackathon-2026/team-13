-- 009_similarity_matches.sql
-- Schema doc section 8.1 — what the RAG agent retrieved for an incident, and how close it was.
--
-- Intentionally NOT unique on (incident_id, knowledge_document_id): re-running retrieval
-- after the corpus grows should record a new match with its own score and timestamp.
-- Read the newest run with DISTINCT ON or a created_at filter.

CREATE TABLE IF NOT EXISTS similarity_matches (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id            UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    knowledge_document_id  UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    similarity_score       NUMERIC(6, 5) NOT NULL,
    match_type             match_type NOT NULL DEFAULT 'SEMANTIC',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_similarity_matches_score
        CHECK (similarity_score >= 0 AND similarity_score <= 1)
);

-- "Top matches for this incident, best first" — the dashboard's similar-incidents panel.
CREATE INDEX IF NOT EXISTS idx_similarity_matches_incident
    ON similarity_matches(incident_id, similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_similarity_matches_document
    ON similarity_matches(knowledge_document_id);
