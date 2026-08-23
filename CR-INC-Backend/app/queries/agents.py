"""SQL for the agent roster, its policy, and the guardrails that bound it.

The roster reads `v_agent_performance`, which has existed since
011_dashboard_views.sql and until now was queried by nothing.
"""

from __future__ import annotations

# What the policy gate needs, for one agent, in three round trips rather than
# one join: risk policy and skills are both one-to-many off the same agent, and
# joining them together would multiply the rows and make the caller undo it.
AGENT_POLICY = """
SELECT id, name, autonomy, is_active
  FROM agents
 WHERE name = $1
"""

RISK_POLICY_FOR_AGENT = """
SELECT risk_level::text AS risk_level, disposition
  FROM agent_risk_policy
 WHERE agent_id = $1
"""

# service_id as well as the name: the name is what a card renders, and the id is
# what a form has to pre-select. Matching a dropdown on a display name would be
# picking a row by something that is not its key.
SKILLS_FOR_AGENT = """
SELECT sk.id, sk.name, sk.description, sk.action_type, sk.risk_level::text AS risk_level,
       sk.enabled, sk.environments, sk.service_id, s.name AS service_name
  FROM agent_skills sk
  LEFT JOIN services s ON s.id = sk.service_id
 WHERE sk.agent_id = $1
 ORDER BY sk.name
"""

GUARDRAILS = """
SELECT max_concurrent_executions,
       blackout_start_dow, blackout_start_time,
       blackout_end_dow, blackout_end_time,
       never_touch_services
  FROM orchestrator_guardrails
 WHERE id
"""

# Counted, not estimated: the ceiling is about what is happening right now, and
# executed_actions.status is the only place that is written down.
RUNNING_EXECUTIONS = "SELECT COUNT(*) FROM executed_actions WHERE status = 'RUNNING'"

# ----------------------------------------------------------------- roster
# The stats come from the view; is_active and autonomy from the table. LEFT JOIN
# because an agent that has never run still belongs in the roster — a roster that
# hid it would hide exactly the ones worth asking about.
ROSTER = """
SELECT a.id, a.name, a.description, a.version, a.is_active, a.autonomy, a.updated_at,
       COALESCE(p.total_runs, 0)      AS total_runs,
       COALESCE(p.successful_runs, 0) AS successful_runs,
       COALESCE(p.failed_runs, 0)     AS failed_runs,
       p.success_rate,
       p.avg_confidence_score,
       p.avg_latency_ms
  FROM agents a
  LEFT JOIN v_agent_performance p ON p.agent_name = a.name AND p.version = a.version
 ORDER BY a.name
"""

AGENT_BY_ID = """
SELECT a.id, a.name, a.description, a.version, a.is_active, a.autonomy, a.updated_at,
       COALESCE(p.total_runs, 0)      AS total_runs,
       COALESCE(p.successful_runs, 0) AS successful_runs,
       COALESCE(p.failed_runs, 0)     AS failed_runs,
       p.success_rate,
       p.avg_confidence_score,
       p.avg_latency_ms
  FROM agents a
  LEFT JOIN v_agent_performance p ON p.agent_name = a.name AND p.version = a.version
 WHERE a.id = $1
"""

# The corpus figure the detail card shows as its context — real counts, grouped
# by the document type the operator already sees in the Knowledge tab.
CONTEXT_COUNTS = """
SELECT document_type::text AS document_type, COUNT(*) AS count
  FROM knowledge_documents
 GROUP BY document_type
 ORDER BY count DESC
"""

# ------------------------------------------------------------------ writes
UPDATE_AGENT = """
UPDATE agents
   SET is_active = COALESCE($2, is_active),
       autonomy  = COALESCE($3, autonomy)
 WHERE id = $1
 RETURNING id
"""

UPSERT_RISK_POLICY = """
INSERT INTO agent_risk_policy (agent_id, risk_level, disposition)
VALUES ($1, $2::risk_level, $3)
ON CONFLICT (agent_id, risk_level) DO UPDATE SET disposition = EXCLUDED.disposition
RETURNING agent_id
"""

UPDATE_SKILL = "UPDATE agent_skills SET enabled = $2 WHERE id = $1 RETURNING agent_id"

INSERT_SKILL = """
INSERT INTO agent_skills
    (agent_id, name, description, action_type, risk_level, service_id, environments, enabled)
VALUES ($1, $2, $3, $4, $5::risk_level, $6, $7, $8)
RETURNING id
"""

# Every field optional, and $8 decides whether service_id is being cleared or
# left alone — an explicit null and an omitted field are different intentions and
# COALESCE alone cannot tell them apart.
UPDATE_SKILL_FIELDS = """
UPDATE agent_skills
   SET name         = COALESCE($2, name),
       description  = COALESCE($3, description),
       action_type  = COALESCE($4, action_type),
       risk_level   = COALESCE($5::risk_level, risk_level),
       environments = COALESCE($6, environments),
       enabled      = COALESCE($7, enabled),
       service_id   = CASE WHEN $8 THEN $9 ELSE service_id END
 WHERE id = $1
 RETURNING agent_id
"""

DELETE_SKILL = "DELETE FROM agent_skills WHERE id = $1 RETURNING agent_id"

# Every column is optional, so a caller can set the concurrency ceiling without
# restating a blackout window it never meant to touch. The window is all-or-
# nothing at the schema level, so it is passed as a set.
UPDATE_GUARDRAILS = """
UPDATE orchestrator_guardrails
   SET max_concurrent_executions = COALESCE($1, max_concurrent_executions),
       never_touch_services      = COALESCE($2, never_touch_services),
       blackout_start_dow        = CASE WHEN $3 THEN $4 ELSE blackout_start_dow  END,
       blackout_start_time       = CASE WHEN $3 THEN $5 ELSE blackout_start_time END,
       blackout_end_dow          = CASE WHEN $3 THEN $6 ELSE blackout_end_dow    END,
       blackout_end_time         = CASE WHEN $3 THEN $7 ELSE blackout_end_time   END
 WHERE id
"""

# Skills used per action type, so a skill card can show runs and success without
# a second endpoint. Grouped by action_type because that is the only key
# executed_actions and agent_skills share — a skill is not recorded on a run.
SKILL_USAGE = """
SELECT ra.action_type,
       COUNT(*)                                          AS runs,
       COUNT(*) FILTER (WHERE e.status = 'SUCCESS')       AS successes,
       COUNT(*) FILTER (WHERE e.status <> 'RUNNING')      AS settled
  FROM executed_actions e
  JOIN recommended_actions ra ON ra.id = e.recommended_action_id
 GROUP BY ra.action_type
"""
