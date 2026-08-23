-- 004_services_incidents.sql
-- Schema doc sections 3.1 and 3.2 — the core operational entities.

CREATE TABLE IF NOT EXISTS services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    owner           VARCHAR(255),
    repository_url  TEXT,
    environment     VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_services_updated_at ON services;
CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS incidents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id         VARCHAR(255),
    title               VARCHAR(500) NOT NULL,
    description         TEXT,
    status              incident_status NOT NULL DEFAULT 'OPEN',
    priority            incident_priority NOT NULL DEFAULT 'P3',
    category            VARCHAR(100),
    source              VARCHAR(50),
    service_id          UUID REFERENCES services(id) ON DELETE SET NULL,
    environment         VARCHAR(50),
    assigned_to         VARCHAR(255),
    is_known_incident   BOOLEAN NOT NULL DEFAULT FALSE,
    confidence_score    NUMERIC(5, 4),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ,
    resolution_summary  TEXT,

    CONSTRAINT chk_incidents_confidence_score
        CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
    CONSTRAINT chk_incidents_resolved_after_created
        CHECK (resolved_at IS NULL OR resolved_at >= created_at)
);

DROP TRIGGER IF EXISTS trg_incidents_updated_at ON incidents;
CREATE TRIGGER trg_incidents_updated_at
    BEFORE UPDATE ON incidents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes from the schema doc (section 3.2).
CREATE INDEX IF NOT EXISTS idx_incidents_status     ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_priority   ON incidents(priority);
CREATE INDEX IF NOT EXISTS idx_incidents_service    ON incidents(service_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_category   ON incidents(category);

-- Makes intake idempotent: re-delivering the same email / PagerDuty alert cannot
-- create a second incident. Use INSERT ... ON CONFLICT DO NOTHING in the intake agent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_source_external_id
    ON incidents(source, external_id)
    WHERE external_id IS NOT NULL;

-- Fuzzy title lookup ("did we see something like this?") before falling back to vectors.
CREATE INDEX IF NOT EXISTS idx_incidents_title_trgm
    ON incidents USING gin (title gin_trgm_ops);
