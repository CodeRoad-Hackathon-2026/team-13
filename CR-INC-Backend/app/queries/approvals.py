"""SQL for the approval queue and the approve/reject lifecycle."""

from __future__ import annotations

# FR-031/FR-032/AR-10: the server excludes approval_required = FALSE and orders
# priority -> risk -> age. The client has no code path that could do either, by
# design (P-3), so both belong here.
#
# `proposed_at` is recommended_actions.created_at, and `proposed_by_agent` comes
# from the agent run that proposed it — the Decision Agent writes that link.
PENDING = """
SELECT
    ra.id,
    ra.incident_id,
    i.external_id            AS incident_external_id,
    i.priority,
    COALESCE(s.name, '')     AS service_name,
    i.environment,
    i.title                  AS incident_title,
    ra.action_type,
    COALESCE(ra.description, '') AS description,
    ra.risk_level,
    COALESCE(ra.confidence_score, 0) AS confidence_score,
    ra.created_at            AS proposed_at,
    COALESCE(a.name, 'orchestrator') AS proposed_by_agent
FROM recommended_actions ra
JOIN incidents i        ON i.id = ra.incident_id
LEFT JOIN services s    ON s.id = i.service_id
LEFT JOIN agent_runs r  ON r.id = ra.agent_run_id
LEFT JOIN agents a      ON a.id = r.agent_id
WHERE ra.status = 'PROPOSED' AND ra.approval_required
ORDER BY
    CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
    CASE ra.risk_level WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
    i.created_at ASC
"""

# AR-4: the three best matches travel with the card so "Why this action" needs
# no second request. Capped server-side.
TOP_MATCHES = """
SELECT
    sm.incident_id,
    kd.document_type,
    kd.title,
    sm.similarity_score AS score,
    COALESCE(kd.source_url, '') AS source_url
FROM similarity_matches sm
JOIN knowledge_documents kd ON kd.id = sm.knowledge_document_id
WHERE sm.incident_id = ANY($1::uuid[])
ORDER BY sm.incident_id, sm.similarity_score DESC
"""

# AR-9's empty state: "N executed automatically in the last 7 days".
AUTO_EXECUTED_IN_RANGE = """
SELECT COUNT(*)
FROM executed_actions e
JOIN recommended_actions ra ON ra.id = e.recommended_action_id
WHERE ra.approval_required = FALSE
  AND e.status = 'SUCCESS'
  AND e.started_at >= now() - INTERVAL '7 days'
"""

# Locked so two concurrent approvals of the same action cannot both observe
# PROPOSED. The 409 below is only correct if the read and the write are atomic.
LOCK_ACTION = """
SELECT ra.id, ra.status, ra.risk_level, ra.incident_id, ra.agent_run_id
FROM recommended_actions ra
WHERE ra.id = $1
FOR UPDATE
"""

APPROVE = """
UPDATE recommended_actions
   SET status = 'APPROVED', approved_by = $2, approved_at = now()
 WHERE id = $1
"""

# The contract reuses approved_by/approved_at for rejection — there are no
# rejected_by/rejected_at columns, and the reason lives on developer_feedback.
REJECT = """
UPDATE recommended_actions
   SET status = 'REJECTED', approved_by = $2, approved_at = now()
 WHERE id = $1
RETURNING approved_by, approved_at
"""

START_EXECUTION = """
INSERT INTO executed_actions (recommended_action_id, status, started_at, executed_by)
VALUES ($1, 'RUNNING', now(), $2)
RETURNING id
"""

REJECTION_FEEDBACK = """
INSERT INTO developer_feedback (
    incident_id, agent_run_id, recommended_action_id, feedback_type, comments,
    corrected_category, corrected_priority, created_by
) VALUES ($1, $2, $3, 'REJECTED', $4, $5, $6::incident_priority, $7)
"""

# :id here is the RECOMMENDED action id, not the execution id — the frontend
# polls by the action it approved.
EXECUTION_STATUS = """
SELECT status, error_message, started_at, finished_at
FROM executed_actions
WHERE recommended_action_id = $1
ORDER BY started_at DESC
LIMIT 1
"""

ACTION_PARAMETERS = "SELECT parameters FROM recommended_actions WHERE id = $1"

# Everything the pre-flight guards read, in one row. services.repository_url is
# here because resolve_repo treats it as the source of truth and the planner's
# own `repo` as a claim to check against it — so a pre-flight that only looked at
# parameters would report a repository the delivery agent might refuse.
ACTION_PREFLIGHT = """
SELECT ra.action_type, ra.parameters, ra.status::text AS status, ra.approved_by,
       s.repository_url
FROM recommended_actions ra
JOIN incidents i ON i.id = ra.incident_id
LEFT JOIN services s ON s.id = i.service_id
WHERE ra.id = $1
"""
