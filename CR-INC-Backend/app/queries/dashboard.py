"""SQL for the dashboard's aggregate endpoints.

None of this uses the views in 011_dashboard_views.sql. Those aggregate the whole
table with no parameters, and every endpoint here is filtered by time range,
environment and service — plus every tile wants a period-over-period delta the
views cannot express, and the UI wants a median where the views compute a mean
(N1b: median is the requirement, the average belongs in a tooltip).
"""

from __future__ import annotations

# ------------------------------------------------------------- alert strip
# Takes no parameters at all, by requirement (FR-014): the strip always shows
# current state whatever range or filter is selected elsewhere.
ALERT_STRIP = """
SELECT
    (SELECT COUNT(*) FROM incidents
      WHERE priority = 'P1' AND status NOT IN ('RESOLVED', 'CLOSED'))          AS p1_active,
    (SELECT COUNT(*) FROM recommended_actions
      WHERE status = 'PROPOSED' AND approval_required)                          AS awaiting_approval,
    (SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 60
       FROM recommended_actions
      WHERE status = 'PROPOSED' AND approval_required)                          AS oldest_pending_minutes,
    (SELECT COUNT(*)
       FROM executed_actions e
       JOIN recommended_actions ra ON ra.id = e.recommended_action_id
      WHERE ra.approval_required = FALSE
        AND e.status = 'SUCCESS'
        AND e.started_at >= now() - INTERVAL '7 days')                          AS auto_executed
"""

# ---------------------------------------------------------------- now tiles
# $1 = environments (NULL for all), $2 = service id (NULL for all).
#
# The deltas compare against the same predicate 24 hours ago. "Open then" is
# exact — created_at and resolved_at are both recorded. Status and assignment
# are not versioned anywhere, so those two deltas read the *current* status of
# incidents that already existed 24h ago; they measure arrivals and departures,
# not status churn. Stating it here because the number is otherwise easy to
# over-read.
NOW_TILES = """
WITH scoped AS (
    SELECT i.*
    FROM incidents i
    WHERE ($1::text[] IS NULL OR i.environment = ANY($1::text[]))
      AND ($2::uuid   IS NULL OR i.service_id = $2::uuid)
),
existed_24h_ago AS (
    SELECT * FROM scoped
    WHERE created_at <= now() - INTERVAL '24 hours'
      AND (resolved_at IS NULL OR resolved_at > now() - INTERVAL '24 hours')
)
SELECT
    (SELECT COUNT(*) FROM scoped WHERE status NOT IN ('RESOLVED','CLOSED'))            AS open_now,
    (SELECT COUNT(*) FROM existed_24h_ago)                                              AS open_before,
    (SELECT COUNT(*) FROM scoped WHERE status = 'ESCALATED')                            AS escalated_now,
    (SELECT COUNT(*) FROM existed_24h_ago WHERE status = 'ESCALATED')                   AS escalated_before,
    (SELECT COUNT(*) FROM scoped
      WHERE assigned_to IS NULL AND status NOT IN ('RESOLVED','CLOSED'))                AS unassigned_now,
    (SELECT COUNT(*) FROM existed_24h_ago WHERE assigned_to IS NULL)                    AS unassigned_before
"""

OLDEST_OPEN = """
SELECT EXTRACT(EPOCH FROM (now() - created_at)) / 60 AS age_minutes, priority
FROM incidents
WHERE status NOT IN ('RESOLVED','CLOSED')
  AND ($1::text[] IS NULL OR environment = ANY($1::text[]))
  AND ($2::uuid   IS NULL OR service_id = $2::uuid)
ORDER BY created_at ASC
LIMIT 1
"""

# -------------------------------------------------------------- performance
# $1 = from, $2 = to, $3 = environments, $4 = service.
PERFORMANCE_TILES = """
WITH scoped AS (
    SELECT i.*
    FROM incidents i
    WHERE i.created_at >= $1 AND i.created_at < $2
      AND ($3::text[] IS NULL OR i.environment = ANY($3::text[]))
      AND ($4::uuid   IS NULL OR i.service_id = $4::uuid)
),
resolved AS (
    SELECT EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60 AS minutes
    FROM scoped WHERE resolved_at IS NOT NULL
),
automated AS (
    SELECT
        COUNT(*) FILTER (WHERE ra.approval_required = FALSE AND e.status = 'SUCCESS') AS fully,
        COUNT(*) FILTER (WHERE ra.approval_required AND ra.status IN ('APPROVED','EXECUTED')
                           AND e.status = 'SUCCESS')                                  AS assisted,
        COUNT(*)                                                                       AS total
    FROM recommended_actions ra
    JOIN scoped s ON s.id = ra.incident_id
    LEFT JOIN executed_actions e ON e.recommended_action_id = ra.id
)
SELECT
    (SELECT COUNT(*) FROM scoped)                                        AS incident_count,
    (SELECT COUNT(*) FROM scoped WHERE is_known_incident)                AS known_count,
    -- Median, not average. The average is returned alongside for the tooltip.
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) FROM resolved) AS median_minutes,
    (SELECT AVG(minutes) FROM resolved)                                  AS average_minutes,
    (SELECT fully FROM automated)                                        AS fully_automated,
    (SELECT assisted FROM automated)                                     AS human_assisted,
    (SELECT total FROM automated)                                        AS action_total
"""

# The funnel, one row per stage count. Deliberately counts only — the
# largest-drop annotation and the drill-down targets are computed client-side.
#
# Each stage is a strict subset of the one above it. That is what makes a funnel
# a funnel: a stage that merely counts "incidents with a recommendation" can
# exceed the stage above when something was recommended without a RAG match, and
# a stage that grows produces a negative drop, which is not a thing.
FUNNEL = """
WITH scoped AS (
    SELECT i.*
    FROM incidents i
    WHERE i.created_at >= $1 AND i.created_at < $2
      AND ($3::text[] IS NULL OR i.environment = ANY($3::text[]))
      AND ($4::uuid   IS NULL OR i.service_id = $4::uuid)
),
classified AS (SELECT * FROM scoped WHERE category IS NOT NULL),
matched AS (SELECT * FROM classified WHERE is_known_incident),
recommended AS (
    SELECT m.* FROM matched m
    WHERE EXISTS (SELECT 1 FROM recommended_actions ra WHERE ra.incident_id = m.id)
),
approved AS (
    SELECT r.* FROM recommended r
    WHERE EXISTS (
        SELECT 1 FROM recommended_actions ra
        WHERE ra.incident_id = r.id
          AND (ra.status IN ('APPROVED','EXECUTED') OR ra.approval_required = FALSE)
    )
),
executed_ok AS (
    SELECT a.* FROM approved a
    WHERE EXISTS (
        SELECT 1 FROM recommended_actions ra
        JOIN executed_actions e ON e.recommended_action_id = ra.id
        WHERE ra.incident_id = a.id AND e.status = 'SUCCESS'
    )
)
SELECT
    (SELECT COUNT(*) FROM scoped)      AS received,
    (SELECT COUNT(*) FROM classified)  AS classified,
    (SELECT COUNT(*) FROM matched)     AS rag_matched,
    (SELECT COUNT(*) FROM recommended) AS recommended,
    (SELECT COUNT(*) FROM approved)    AS approved_or_auto,
    (SELECT COUNT(*) FROM executed_ok) AS executed_ok
"""

OUTCOMES = """
WITH scoped_exec AS (
    SELECT e.*, ra.action_type, ra.incident_id
    FROM executed_actions e
    JOIN recommended_actions ra ON ra.id = e.recommended_action_id
    JOIN incidents i            ON i.id = ra.incident_id
    WHERE e.started_at >= $1 AND e.started_at < $2
      AND ($3::text[] IS NULL OR i.environment = ANY($3::text[]))
      AND ($4::uuid   IS NULL OR i.service_id = $4::uuid)
)
SELECT
    COUNT(*) FILTER (WHERE status = 'SUCCESS')      AS success,
    COUNT(*) FILTER (WHERE status = 'FAILED')       AS failed,
    -- EO-1: its own bucket, never folded into failed.
    COUNT(*) FILTER (WHERE status = 'ROLLED_BACK')  AS rolled_back,
    COUNT(*) FILTER (WHERE status = 'RUNNING')      AS running,
    percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at)) / 60
    ) FILTER (WHERE finished_at IS NOT NULL)        AS median_minutes
FROM scoped_exec
"""

# median_minutes is over settled runs only: a RUNNING execution has no finished_at, and counting
# it as zero would report a remediation as faster the longer it hangs.
OUTCOMES_BY_ACTION_TYPE = """
SELECT ra.action_type,
       COUNT(*) FILTER (WHERE e.status = 'SUCCESS')      AS success,
       COUNT(*) FILTER (WHERE e.status = 'FAILED')       AS failed,
       COUNT(*) FILTER (WHERE e.status = 'ROLLED_BACK')  AS rolled_back,
       COUNT(*) FILTER (WHERE e.status = 'RUNNING')      AS running,
       PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (e.finished_at - e.started_at)) / 60.0
       ) FILTER (WHERE e.finished_at IS NOT NULL)        AS median_minutes
FROM executed_actions e
JOIN recommended_actions ra ON ra.id = e.recommended_action_id
JOIN incidents i            ON i.id = ra.incident_id
WHERE e.started_at >= $1 AND e.started_at < $2
  AND ($3::text[] IS NULL OR i.environment = ANY($3::text[]))
  AND ($4::uuid   IS NULL OR i.service_id = $4::uuid)
GROUP BY ra.action_type
ORDER BY ra.action_type
"""

# Truncated server-side: the panel shows one line per failure, and an untruncated
# stack trace would blow the layout apart.
RECENT_FAILURES = """
SELECT e.id AS executed_action_id, ra.incident_id, ra.action_type,
       LEFT(COALESCE(e.error_message, 'Execution failed.'), 80) AS message,
       LENGTH(COALESCE(e.error_message, '')) AS full_length
FROM executed_actions e
JOIN recommended_actions ra ON ra.id = e.recommended_action_id
JOIN incidents i            ON i.id = ra.incident_id
WHERE e.status = 'FAILED'
  AND e.started_at >= $1 AND e.started_at < $2
  AND ($3::text[] IS NULL OR i.environment = ANY($3::text[]))
  AND ($4::uuid   IS NULL OR i.service_id = $4::uuid)
ORDER BY e.started_at DESC
LIMIT 5
"""

# -------------------------------------------------------------- breakdowns
# No service filter here — the frontend does not send one for this endpoint.
VOLUME = """
SELECT date_trunc('day', created_at)::date AS bucket_start,
       COUNT(*) FILTER (WHERE is_known_incident)      AS known,
       COUNT(*) FILTER (WHERE NOT is_known_incident)  AS unknown,
       percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60
       ) FILTER (WHERE resolved_at IS NOT NULL)       AS median_minutes
FROM incidents
WHERE created_at >= $1 AND created_at < $2
  AND ($3::text[] IS NULL OR environment = ANY($3::text[]))
GROUP BY 1
ORDER BY 1
"""

BY_PRIORITY = """
SELECT priority, COUNT(*) AS count
FROM incidents
WHERE created_at >= $1 AND created_at < $2
  AND ($3::text[] IS NULL OR environment = ANY($3::text[]))
GROUP BY priority
ORDER BY priority
"""

BY_CATEGORY = """
SELECT COALESCE(category, 'Uncategorised') AS category, COUNT(*) AS count
FROM incidents
WHERE created_at >= $1 AND created_at < $2
  AND ($3::text[] IS NULL OR environment = ANY($3::text[]))
GROUP BY 1
ORDER BY count DESC, category
"""

BY_SERVICE = """
SELECT s.id AS service_id, s.name AS service_name, COUNT(i.id) AS count,
       COALESCE(AVG(CASE WHEN i.is_known_incident THEN 1.0 ELSE 0.0 END), 0) AS known_rate
FROM services s
JOIN incidents i ON i.service_id = s.id
WHERE i.created_at >= $1 AND i.created_at < $2
  AND ($3::text[] IS NULL OR i.environment = ANY($3::text[]))
GROUP BY s.id, s.name
ORDER BY count DESC
LIMIT 5
"""

# --------------------------------------------------------------- knowledge
# Takes only from/to — no environment or service, per the frontend's client.
KNOWLEDGE_TILES = """
SELECT
    -- Counted from documents, not embeddings: knowledge_embeddings is not
    -- populated by any code path, RAG Core owns the vector store.
    (SELECT COUNT(*) FROM knowledge_documents)                        AS document_count,
    (SELECT COUNT(DISTINCT document_type) FROM knowledge_documents)   AS document_type_count,
    (SELECT COUNT(DISTINCT service_id) FROM knowledge_documents
      WHERE document_type = 'RUNBOOK' AND service_id IS NOT NULL)     AS services_with_runbook,
    (SELECT COUNT(*) FROM services)                                   AS total_services,
    -- K1: resolved AND undocumented. Narrower than K4's candidate backlog,
    -- which also counts unresolved repeats — the two are computed separately.
    (SELECT COUNT(*) FROM incidents
      WHERE status IN ('RESOLVED','CLOSED') AND NOT is_known_incident
        AND created_at >= $1 AND created_at < $2)                     AS undocumented_resolutions
"""

# Worst first (FR-100) — the ordering is the point of the panel.
COVERAGE_GAPS = """
SELECT s.id AS service_id, s.name AS service_name,
       COALESCE(AVG(CASE WHEN i.is_known_incident THEN 1.0 ELSE 0.0 END), 0) AS known_rate
FROM services s
LEFT JOIN incidents i ON i.service_id = s.id AND i.created_at >= $1 AND i.created_at < $2
GROUP BY s.id, s.name
ORDER BY known_rate ASC, s.name
"""

# K3: resolutionCount is computed, never stored.
DOCUMENTS_DRIVING_RESOLUTIONS = """
SELECT kd.id AS document_id, kd.document_type, kd.title,
       COUNT(DISTINCT sm.incident_id) AS resolution_count
FROM knowledge_documents kd
JOIN similarity_matches sm ON sm.knowledge_document_id = kd.id
JOIN incidents i           ON i.id = sm.incident_id
WHERE i.status IN ('RESOLVED','CLOSED')
  AND i.created_at >= $1 AND i.created_at < $2
GROUP BY kd.id, kd.document_type, kd.title
ORDER BY resolution_count DESC, kd.title
LIMIT 10
"""
