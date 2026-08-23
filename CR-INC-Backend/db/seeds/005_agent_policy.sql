-- 005_agent_policy.sql
-- The policy an operator inherits before they have made any decisions.
--
-- Chosen to be defensible on a fresh install rather than convenient for a demo:
-- everything asks a person, and the only thing that runs unattended is a LOW
-- risk action from the one agent whose job is to propose them.

-- ------------------------------------------------------------- guardrails
-- One row. Deliberately empty of a blackout window: an inherited window nobody
-- chose would silently explain away every deferred action, and the operator
-- would have no idea why.
INSERT INTO orchestrator_guardrails (id, max_concurrent_executions, never_touch_services)
VALUES (TRUE, 2, ARRAY[]::TEXT[])
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------ risk policy
-- Three rows per agent, for all of them, so a missing level is a bug rather
-- than a silent default. HIGH and MEDIUM ask; LOW asks too, except for the
-- Decision Agent.
--
-- Only the Decision Agent gets an auto-run, because it is the only agent that
-- proposes actions — the rest have a policy row so the table is complete and so
-- turning one of them into a proposer later does not inherit permission it was
-- never granted.
-- The disposition is decided in the INSERT rather than patched afterwards, so
-- ON CONFLICT DO NOTHING is what protects an operator who has already chosen:
-- re-running the seeds must never quietly re-grant permission somebody revoked.
INSERT INTO agent_risk_policy (agent_id, risk_level, disposition)
SELECT a.id,
       r.risk_level,
       CASE
           WHEN a.name = 'Decision Agent' AND r.risk_level = 'LOW' THEN 'auto_run'
           ELSE 'ask_first'
       END
  FROM agents a
 CROSS JOIN (VALUES ('LOW'::risk_level), ('MEDIUM'::risk_level), ('HIGH'::risk_level)) AS r(risk_level)
ON CONFLICT (agent_id, risk_level) DO NOTHING;

-- ----------------------------------------------------------------- skills
-- The catalogue an operator reads, derived from the runbooks in
-- 004_code_change_runbooks.sql — one skill per runbook whose remediation is a
-- code change, plus the two operational actions the demo data already exercises.
--
-- risk_level here is the skill's *inherent* risk, which is what an operator
-- reasons about when switching it off. It is not the risk the planner assigns to
-- a particular action: the same skill can produce a riskier action on a Friday
-- than on a Tuesday, and the policy reads the planner's number, not this one.
INSERT INTO agent_skills (agent_id, name, description, action_type, risk_level, service_id, environments)
SELECT a.id, s.name, s.description, s.action_type, s.risk_level, s.service_id, s.environments
  FROM agents a
  CROSS JOIN (VALUES
    -- Runbook #58
    ('Lower the upstream client timeout',
     'Reduces read_timeout_seconds and max_retries in config/http_clients.yml so one slow upstream call cannot starve the worker pool.',
     'GITHUB_PR', 'MEDIUM'::risk_level,
     '11111111-0003-4000-8000-000000000001'::uuid, ARRAY['Production','Staging']),
    -- Runbook #61
    ('Hoist the N+1 warehouse lookup',
     'Moves the per-item warehouse query out of the sync loop in app/jobs/inventory_sync.py.',
     'GITHUB_PR', 'LOW'::risk_level,
     '11111111-1111-1111-1111-111111111112'::uuid, ARRAY['Production']),
    -- Runbook #64
    ('Add the notifications dequeue index',
     'Adds the composite index the dequeue query needs, in a new migration file — CONCURRENTLY, so it cannot run in a transaction.',
     'GITHUB_PR', 'MEDIUM'::risk_level,
     '11111111-0003-4000-8000-000000000003'::uuid, ARRAY['Production']),
    -- The two the demo data already exercises. API, so they have a registered
    -- executor — unlike LAMBDA and SQL, which are in the planner's vocabulary
    -- with no tool behind them.
    ('Restart the connection pool',
     'Raises the pgbouncer ceiling and drains idle clients.',
     'API', 'HIGH'::risk_level,
     '11111111-1111-1111-1111-111111111111'::uuid, ARRAY['Production','Staging']),
    ('Purge the CDN cache',
     'Soft purge by surrogate key, so the origin is not stampeded.',
     'API', 'MEDIUM'::risk_level,
     '11111111-0003-4000-8000-000000000001'::uuid, ARRAY['Production'])
  ) AS s(name, description, action_type, risk_level, service_id, environments)
 WHERE a.name = 'Decision Agent'
ON CONFLICT (agent_id, name) DO NOTHING;
