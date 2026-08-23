"""SQL for the incident list, the detail drawer, and its lazily-loaded panels."""

from __future__ import annotations

# The list's projection. automation_status is derived here rather than in Python
# so paging and sorting see the same row the client will.
#
#   none          — nothing was ever recommended
#   needs_human   — something is still waiting on a person
#   fully_automated — ran without needing approval, and succeeded
#   human_approved  — a person approved it, and it succeeded
LIST_SELECT = """
SELECT
    i.id, i.external_id, i.priority, i.status, i.title,
    COALESCE(s.name, '') AS service_name,
    i.environment, COALESCE(i.category, '') AS category,
    i.is_known_incident, i.confidence_score, i.created_at, i.assigned_to,
    COALESCE(i.source, 'Manual') AS source,
    i.resolved_at,
    (SELECT MAX(sm.similarity_score) FROM similarity_matches sm
      WHERE sm.incident_id = i.id) AS best_match_score,
    (SELECT COUNT(*) FROM recommended_actions ra WHERE ra.incident_id = i.id) AS action_count,
    (SELECT COUNT(*) FROM recommended_actions ra
      WHERE ra.incident_id = i.id AND ra.status = 'PROPOSED') AS proposed_count,
    (SELECT COUNT(*) FROM recommended_actions ra
       JOIN executed_actions e ON e.recommended_action_id = ra.id
      WHERE ra.incident_id = i.id AND ra.approval_required = FALSE
        AND e.status = 'SUCCESS') AS auto_success_count,
    (SELECT COUNT(*) FROM recommended_actions ra
       JOIN executed_actions e ON e.recommended_action_id = ra.id
      WHERE ra.incident_id = i.id AND ra.approval_required
        AND ra.status IN ('APPROVED','EXECUTED') AND e.status = 'SUCCESS') AS approved_success_count
FROM incidents i
LEFT JOIN services s ON s.id = i.service_id
"""

# Ordering per sort mode. Tie-breaks are part of the contract: two equal rows
# must not reshuffle between pages.
ORDER_BY = {
    "age": "i.created_at ASC",
    "confidence": "COALESCE(i.confidence_score, 0) DESC, i.created_at DESC",
    "priority": (
        "CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, "
        "i.created_at DESC"
    ),
}

DETAIL = """
SELECT i.id, i.external_id, i.title, i.status, i.priority,
       COALESCE(s.name, '') AS service_name, i.environment, i.assigned_to,
       i.created_at, i.resolved_at, COALESCE(i.source, 'Manual') AS source,
       COALESCE(i.category, '') AS category, i.confidence_score
FROM incidents i
LEFT JOIN services s ON s.id = i.service_id
WHERE i.id = $1
"""

# The first correction wins: it is what the drawer shows as "AI said X, human
# corrected to Y".
CORRECTION = """
SELECT corrected_category, corrected_priority
FROM developer_feedback
WHERE incident_id = $1
  AND (corrected_category IS NOT NULL OR corrected_priority IS NOT NULL)
ORDER BY created_at ASC
LIMIT 1
"""

# hasError, not error_message: the message itself needs the lazy io endpoint.
AGENT_RUNS = """
SELECT r.id, a.name AS agent_name, a.version AS agent_version, r.status,
       r.started_at, r.finished_at, r.latency_ms, r.confidence_score
FROM agent_runs r
JOIN agents a ON a.id = r.agent_id
WHERE r.incident_id = $1
ORDER BY r.started_at ASC
"""

SIMILARITY_MATCHES = """
SELECT sm.id, kd.document_type, kd.title, sm.similarity_score AS score,
       COALESCE(kd.summary, '') AS summary_snippet,
       COALESCE(kd.source_url, '') AS source_url
FROM similarity_matches sm
JOIN knowledge_documents kd ON kd.id = sm.knowledge_document_id
WHERE sm.incident_id = $1
ORDER BY sm.similarity_score DESC
"""

ACTIONS = """
SELECT ra.id, ra.action_type, COALESCE(ra.description, '') AS description,
       ra.risk_level, COALESCE(ra.confidence_score, 0) AS confidence_score,
       ra.status, ra.approved_by, ra.approved_at, ra.approval_required,
       e.id AS execution_id, e.status AS execution_status,
       e.started_at AS execution_started_at, e.finished_at AS execution_finished_at,
       e.error_message AS execution_error
FROM recommended_actions ra
LEFT JOIN LATERAL (
    SELECT * FROM executed_actions ex
    WHERE ex.recommended_action_id = ra.id
    ORDER BY ex.started_at DESC LIMIT 1
) e ON TRUE
WHERE ra.incident_id = $1
ORDER BY ra.created_at ASC
"""

# $2 = agent-only. Filtered in SQL rather than in the client because per-incident
# event volume is unbounded.
EVENTS = """
SELECT id, event_type, COALESCE(description, '') AS description,
       COALESCE(created_by, 'system') AS created_by, created_at
FROM incident_events
WHERE incident_id = $1
  AND ($2::boolean IS NOT TRUE OR created_by LIKE '%Agent%')
ORDER BY created_at ASC
"""

FEEDBACK = """
SELECT id, feedback_type, COALESCE(comments, '') AS comments,
       corrected_category, corrected_priority, corrected_resolution,
       COALESCE(created_by, 'unknown') AS created_by, created_at
FROM developer_feedback
WHERE incident_id = $1
ORDER BY created_at DESC
"""

AGENT_RUN_IO = """
SELECT input, output FROM agent_runs WHERE id = $1 AND incident_id = $2
"""

EXECUTION_DETAIL = """
SELECT response_payload, COALESCE(execution_logs, '') AS execution_logs
FROM executed_actions WHERE id = $1
"""

INSERT_FEEDBACK = """
INSERT INTO developer_feedback (
    incident_id, feedback_type, comments, corrected_category,
    corrected_priority, corrected_resolution, created_by
) VALUES ($1, $2::feedback_type, $3, $4, $5::incident_priority, $6, $7)
RETURNING id, feedback_type, comments, corrected_category, corrected_priority,
          corrected_resolution, created_by, created_at
"""

# Personal figures are all-time; team figures are the current calendar quarter.
FEEDBACK_IMPACT = """
SELECT
    (SELECT COUNT(*) FROM developer_feedback WHERE created_by = $1)              AS personal_count,
    (SELECT MAX(created_at) FROM developer_feedback WHERE created_by = $1)       AS last_correction,
    (SELECT COUNT(*) FROM developer_feedback
      WHERE date_trunc('quarter', created_at) = date_trunc('quarter', now()))    AS team_count,
    (SELECT COUNT(DISTINCT created_by) FROM developer_feedback
      WHERE date_trunc('quarter', created_at) = date_trunc('quarter', now()))    AS engineer_count,
    (SELECT COUNT(*) FROM incidents WHERE is_known_incident)                     AS known_incidents,
    (SELECT COUNT(*) FROM incidents)                                             AS total_incidents
"""
