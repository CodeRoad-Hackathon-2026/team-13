-- 003_dashboard_demo.sql
-- Demo data sized for the dashboard rather than for the schema.
--
-- 002 proves one incident lifecycle end to end. It cannot demo the product: with
-- no PROPOSED action the approval queue, the alert strip's awaiting-approval
-- count and the whole approve/reject flow render empty, and with a single
-- SUCCESS execution the outcomes panel has no failure state to show.
--
-- This file exists to give every panel something real. It is additive and safe
-- to re-run: fixed UUIDs, ON CONFLICT DO NOTHING throughout. The second UUID
-- group is 0003 so nothing here can collide with 002.
--
-- Do not load this in a shared or real environment.

-- ---------------------------------------------------------------- services
INSERT INTO services (id, name, description, owner, repository_url, environment) VALUES
    ('11111111-0003-4000-8000-000000000001', 'checkout-web',
     'Storefront checkout flow.', 'checkout-team',
     'https://github.com/example/checkout-web', 'Production'),
    ('11111111-0003-4000-8000-000000000002', 'auth-gateway',
     'Token issuance and session validation.', 'identity-team',
     'https://github.com/example/auth-gateway', 'Production'),
    ('11111111-0003-4000-8000-000000000003', 'notify-worker',
     'Outbound email and push notification queue.', 'platform-team',
     'https://github.com/example/notify-worker', 'Production'),
    ('11111111-0003-4000-8000-000000000004', 'search-index',
     'Vehicle search indexing pipeline.', 'search-team',
     'https://github.com/example/search-index', 'Production')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------- incidents
-- Ten incidents spanning every priority, every status, three environments and
-- five sources, so no breakdown chart renders with a single bar. Roughly half
-- are unassigned, which is what the Now tab's "unassigned" tile counts.
INSERT INTO incidents (
    id, external_id, title, description, status, priority, category, source,
    service_id, environment, assigned_to, is_known_incident, confidence_score,
    created_at, resolved_at, resolution_summary
) VALUES
    ('22222222-0003-4000-8000-000000000001', 'PD-2101',
     'checkout-web 5xx rate above 8% in eu-west',
     'Error budget burn alert. Checkout POST failing for eu-west traffic.',
     'ESCALATED', 'P1', 'API', 'PagerDuty',
     '11111111-0003-4000-8000-000000000001', 'Production', 'm.tan',
     FALSE, 0.4400, now() - INTERVAL '38 minutes', NULL, NULL),

    ('22222222-0003-4000-8000-000000000002', 'PD-2102',
     'Stale pricing shown after deploy v4.18.2',
     'CDN still serving pre-deploy pricing for tag `pricing`.',
     'INVESTIGATING', 'P2', 'Deployment', 'Slack',
     '11111111-0003-4000-8000-000000000001', 'Production', NULL,
     TRUE, 0.8600, now() - INTERVAL '1 hour 6 minutes', NULL, NULL),

    ('22222222-0003-4000-8000-000000000003', 'EM-2103',
     'Intermittent 401s on token refresh',
     'Refresh-token rows blocking the unique index; a share of refreshes 401.',
     'OPEN', 'P3', 'Security', 'Email',
     '11111111-0003-4000-8000-000000000002', 'Production', NULL,
     TRUE, 0.6200, now() - INTERVAL '2 hours 12 minutes', NULL, NULL),

    ('22222222-0003-4000-8000-000000000004', 'API-2104',
     'Notification queue depth climbing',
     'notify-worker consumer lag growing steadily since 09:00 UTC.',
     'MITIGATED', 'P3', 'Infrastructure', 'API',
     '11111111-0003-4000-8000-000000000003', 'Production', 'j.okafor',
     TRUE, 0.9000, now() - INTERVAL '4 hours', NULL, NULL),

    ('22222222-0003-4000-8000-000000000005', 'MAN-2105',
     'Search index lag 4m behind primary',
     'Indexing pipeline lag beyond the 60s objective.',
     'OPEN', 'P4', 'Infrastructure', 'Manual',
     '11111111-0003-4000-8000-000000000004', 'Production', NULL,
     TRUE, 0.8300, now() - INTERVAL '6 hours', NULL, NULL),

    ('22222222-0003-4000-8000-000000000006', 'PD-2106',
     'Inventory sync deadlock on batch job',
     'Nightly reconciliation deadlocking against the write path.',
     'INVESTIGATING', 'P2', 'Database', 'PagerDuty',
     '11111111-1111-1111-1111-111111111112', 'Production', 'a.reyes',
     TRUE, 0.7700, now() - INTERVAL '3 hours 20 minutes', NULL, NULL),

    -- Resolved through automation: the "fully automated" side of the funnel.
    ('22222222-0003-4000-8000-000000000007', 'PD-2107',
     'auth-gateway certificate rotation warning',
     'Leaf certificate within 7 days of expiry.',
     'RESOLVED', 'P3', 'Security', 'PagerDuty',
     '11111111-0003-4000-8000-000000000002', 'Production', 'j.okafor',
     TRUE, 0.9500, now() - INTERVAL '2 days', now() - INTERVAL '2 days' + INTERVAL '18 minutes',
     'Rotated the leaf certificate and reloaded the gateway. No customer impact.'),

    -- Resolved by hand with no RAG match: a documentation candidate (K4).
    ('22222222-0003-4000-8000-000000000008', 'EM-2108',
     'Checkout totals off by one cent on split tender',
     'Rounding drift when a payment is split across two tenders.',
     'CLOSED', 'P2', 'API', 'Email',
     '11111111-0003-4000-8000-000000000001', 'Production', 'a.reyes',
     FALSE, 0.3100, now() - INTERVAL '5 days', now() - INTERVAL '4 days',
     'Fixed the rounding order in the tender split. No runbook existed.'),

    ('22222222-0003-4000-8000-000000000009', 'SL-2109',
     'Staging notification storm after replay',
     'Replay tooling re-emitted a day of notifications in staging.',
     'RESOLVED', 'P4', 'Infrastructure', 'Slack',
     '11111111-0003-4000-8000-000000000003', 'Staging', 'platform-team',
     TRUE, 0.8800, now() - INTERVAL '3 days', now() - INTERVAL '3 days' + INTERVAL '52 minutes',
     'Drained the replay queue and gated the tool behind a confirmation.'),

    ('22222222-0003-4000-8000-00000000000a', 'API-2110',
     'Search relevance regression in dev after reindex',
     'Relevance scores dropped after the analyzer change.',
     'OPEN', 'P4', 'Deployment', 'API',
     '11111111-0003-4000-8000-000000000004', 'Development', NULL,
     FALSE, 0.2900, now() - INTERVAL '8 hours', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------- knowledge documents
-- service_id is the column 012 added; without it the Knowledge tab cannot count
-- how many services have a runbook.
INSERT INTO knowledge_documents (
    id, title, summary, content, document_type, source, source_url, source_id,
    incident_id, service_id, created_at
) VALUES
    ('77777777-0003-4000-8000-000000000001',
     'Runbook #42 — Restarting a saturated PG pool',
     'Steps to safely drain and restart a PgBouncer pool under load.',
     '1. Confirm saturation via pg_stat_activity. 2. Raise max_connections in two steps. 3. Drain. 4. Restart.',
     'RUNBOOK', 'confluence', 'https://wiki.example.com/runbooks/42', 'RB-2042',
     NULL, '11111111-1111-1111-1111-111111111111', now() - INTERVAL '120 days'),

    ('77777777-0003-4000-8000-000000000002',
     'Runbook #17 — Purge edge cache by tag',
     'How to purge a CDN tag across all edge regions without a full flush.',
     'Use the purge-by-tag API. Never full-flush during peak: origin cannot absorb it.',
     'RUNBOOK', 'confluence', 'https://wiki.example.com/runbooks/17', 'RB-2017',
     NULL, '11111111-0003-4000-8000-000000000001', now() - INTERVAL '95 days'),

    ('77777777-0003-4000-8000-000000000003',
     'Runbook #23 — Clearing expired refresh tokens',
     'Safe deletion of expired refresh-token rows blocking the unique index.',
     'Delete in batches of 5k with a bounded statement timeout. Never a single unbounded DELETE.',
     'RUNBOOK', 'confluence', 'https://wiki.example.com/runbooks/23', 'RB-2023',
     NULL, '11111111-0003-4000-8000-000000000002', now() - INTERVAL '60 days'),

    ('77777777-0003-4000-8000-000000000004',
     'PM-2026-03 — Pool sizing after traffic spike',
     'Postmortem: pool ceiling was sized for pre-migration traffic.',
     'Root cause: max_connections unchanged since the 2025 migration while traffic tripled.',
     'POSTMORTEM', 'confluence', 'https://wiki.example.com/postmortems/2026-03', 'PM-2026-03',
     NULL, '11111111-1111-1111-1111-111111111111', now() - INTERVAL '45 days'),

    ('77777777-0003-4000-8000-000000000005',
     'INC-2107 — auth-gateway certificate rotation',
     'Resolved incident kept as knowledge: rotation procedure that worked.',
     'Rotated leaf cert, reloaded gateway, verified chain. 18 minutes end to end.',
     'INCIDENT', 'orchestrator', 'https://dashboard.example.com/?incident=PD-2107', 'INC-2107',
     '22222222-0003-4000-8000-000000000007', '11111111-0003-4000-8000-000000000002',
     now() - INTERVAL '2 days'),

    ('77777777-0003-4000-8000-000000000006',
     'Queue backpressure and consumer lag',
     'How consumer lag is measured and what to do when it grows.',
     'Lag is measured against the committed offset, not the produced offset.',
     'DOCUMENTATION', 'confluence', 'https://wiki.example.com/docs/queue-backpressure', 'DOC-2091',
     NULL, '11111111-0003-4000-8000-000000000003', now() - INTERVAL '200 days')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------- similarity matches
-- Drives is_known_incident, the drawer's similar-incidents panel, and the
-- approval card's top-3 evidence.
INSERT INTO similarity_matches (id, incident_id, knowledge_document_id, similarity_score, match_type, created_at) VALUES
    ('99999999-0003-4000-8000-000000000001', '22222222-0003-4000-8000-000000000002',
     '77777777-0003-4000-8000-000000000002', 0.86000, 'SEMANTIC', now() - INTERVAL '1 hour 4 minutes'),
    ('99999999-0003-4000-8000-000000000002', '22222222-0003-4000-8000-000000000003',
     '77777777-0003-4000-8000-000000000003', 0.79000, 'SEMANTIC', now() - INTERVAL '2 hours 10 minutes'),
    ('99999999-0003-4000-8000-000000000003', '22222222-0003-4000-8000-000000000003',
     '77777777-0003-4000-8000-000000000004', 0.61000, 'SEMANTIC', now() - INTERVAL '2 hours 10 minutes'),
    ('99999999-0003-4000-8000-000000000004', '22222222-0003-4000-8000-000000000004',
     '77777777-0003-4000-8000-000000000006', 0.90000, 'SEMANTIC', now() - INTERVAL '3 hours 55 minutes'),
    ('99999999-0003-4000-8000-000000000005', '22222222-0003-4000-8000-000000000006',
     '77777777-0003-4000-8000-000000000001', 0.77000, 'SEMANTIC', now() - INTERVAL '3 hours 15 minutes'),
    ('99999999-0003-4000-8000-000000000006', '22222222-0003-4000-8000-000000000007',
     '77777777-0003-4000-8000-000000000005', 0.95000, 'SEMANTIC', now() - INTERVAL '2 days'),
    ('99999999-0003-4000-8000-000000000007', '22222222-0003-4000-8000-000000000005',
     '77777777-0003-4000-8000-000000000006', 0.83000, 'SEMANTIC', now() - INTERVAL '5 hours 50 minutes')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------- agent runs
-- Every run carries its own latency and token cost so v_agent_performance and
-- the drawer's agent trace have something to show. One run FAILED on purpose:
-- without it the agent-health panel has no failure state at all.
INSERT INTO agent_runs (
    id, incident_id, agent_id, status, input, output, confidence_score,
    started_at, finished_at, error_message, tokens_input, tokens_output,
    latency_ms, model, prompt_version
) VALUES
    ('44444444-0003-4000-8000-000000000001', '22222222-0003-4000-8000-000000000002',
     (SELECT id FROM agents WHERE name = 'RAG Retrieval Agent'), 'SUCCESS',
     '{"query": "Stale pricing shown after deploy v4.18.2"}'::jsonb,
     '{"hits": 6, "linked": 1, "best_score": 0.86}'::jsonb, 0.8600,
     now() - INTERVAL '1 hour 5 minutes', now() - INTERVAL '1 hour 4 minutes',
     NULL, NULL, NULL, 2100, NULL, NULL),

    ('44444444-0003-4000-8000-000000000002', '22222222-0003-4000-8000-000000000002',
     (SELECT id FROM agents WHERE name = 'Decision Agent'), 'SUCCESS',
     '{"title": "Stale pricing shown after deploy v4.18.2"}'::jsonb,
     '{"proposed": true, "action_type": "API", "risk_level": "MEDIUM"}'::jsonb, 0.8600,
     now() - INTERVAL '1 hour 4 minutes', now() - INTERVAL '1 hour 3 minutes',
     NULL, 1840, 260, 3500, 'claude-opus-5', 'remediation-planner@3'),

    ('44444444-0003-4000-8000-000000000003', '22222222-0003-4000-8000-000000000003',
     (SELECT id FROM agents WHERE name = 'Decision Agent'), 'SUCCESS',
     '{"title": "Intermittent 401s on token refresh"}'::jsonb,
     '{"proposed": true, "action_type": "SQL", "risk_level": "LOW"}'::jsonb, 0.6200,
     now() - INTERVAL '2 hours 9 minutes', now() - INTERVAL '2 hours 8 minutes',
     NULL, 1610, 210, 2900, 'claude-opus-5', 'remediation-planner@3'),

    ('44444444-0003-4000-8000-000000000004', '22222222-0003-4000-8000-000000000006',
     (SELECT id FROM agents WHERE name = 'Decision Agent'), 'SUCCESS',
     '{"title": "Inventory sync deadlock on batch job"}'::jsonb,
     '{"proposed": true, "action_type": "LAMBDA", "risk_level": "HIGH"}'::jsonb, 0.7700,
     now() - INTERVAL '3 hours 14 minutes', now() - INTERVAL '3 hours 13 minutes',
     NULL, 1990, 300, 4100, 'claude-opus-5', 'remediation-planner@3'),

    -- The failure. Validation could not reach the target after the rollback.
    ('44444444-0003-4000-8000-000000000005', '22222222-0003-4000-8000-000000000001',
     (SELECT id FROM agents WHERE name = 'Validation Agent'), 'FAILED',
     '{"executed_action": "restart-edge-pool"}'::jsonb, NULL, NULL,
     now() - INTERVAL '30 minutes', now() - INTERVAL '29 minutes',
     'Health probe timed out after 30s: checkout-web/eu-west returned 503.',
     NULL, NULL, 30400, NULL, NULL),

    ('44444444-0003-4000-8000-000000000006', '22222222-0003-4000-8000-000000000007',
     (SELECT id FROM agents WHERE name = 'Knowledge Generation Agent'), 'SUCCESS',
     '{"incident": "PD-2107"}'::jsonb,
     '{"knowledge_document_id": "77777777-0003-4000-8000-000000000005"}'::jsonb, 0.9500,
     now() - INTERVAL '2 days' + INTERVAL '20 minutes',
     now() - INTERVAL '2 days' + INTERVAL '21 minutes',
     NULL, 900, 640, 5200, 'claude-opus-5', 'knowledge-writer@1')
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------- recommended actions
-- Three PROPOSED with approval_required — this is the approval queue, and the
-- one thing 002 could not demonstrate. One per risk level so the card's chip,
-- its meter and the HIGH-risk confirm gate are all exercised.
INSERT INTO recommended_actions (
    id, incident_id, agent_run_id, action_type, description, parameters,
    risk_level, confidence_score, approval_required, approved_by, approved_at,
    status, created_at, updated_at
) VALUES
    ('55555555-0003-4000-8000-000000000001', '22222222-0003-4000-8000-000000000006',
     '44444444-0003-4000-8000-000000000004', 'LAMBDA',
     'Restart the inventory-db connection pool via remediation Lambda.',
     '{"function_name": "remediate-pool-restart", "target": "inventory-db-primary", "drain_timeout": "30s"}'::jsonb,
     'HIGH', 0.9100, TRUE, NULL, NULL, 'PROPOSED',
     now() - INTERVAL '3 hours 13 minutes', now() - INTERVAL '3 hours 13 minutes'),

    ('55555555-0003-4000-8000-000000000002', '22222222-0003-4000-8000-000000000002',
     '44444444-0003-4000-8000-000000000002', 'API',
     'Purge CDN cache for tag `pricing` across all edge regions.',
     '{"endpoint": "https://cdn.example.com/purge", "tag": "pricing", "regions": "all"}'::jsonb,
     'MEDIUM', 0.8600, TRUE, NULL, NULL, 'PROPOSED',
     now() - INTERVAL '1 hour 3 minutes', now() - INTERVAL '1 hour 3 minutes'),

    ('55555555-0003-4000-8000-000000000003', '22222222-0003-4000-8000-000000000003',
     '44444444-0003-4000-8000-000000000003', 'SQL',
     'Clear expired refresh-token rows blocking the unique index.',
     '{"statement": "DELETE FROM refresh_tokens WHERE expires_at < now() - INTERVAL ''30 days'' LIMIT 5000"}'::jsonb,
     'LOW', 0.6200, TRUE, NULL, NULL, 'PROPOSED',
     now() - INTERVAL '2 hours 8 minutes', now() - INTERVAL '2 hours 8 minutes'),

    -- Approved by a human, executed, succeeded.
    ('55555555-0003-4000-8000-000000000004', '22222222-0003-4000-8000-000000000004',
     NULL, 'KUBERNETES',
     'Scale notify-worker from 3 to 6 replicas to drain the backlog.',
     '{"deployment": "notify-worker", "replicas": 6}'::jsonb,
     'MEDIUM', 0.9000, TRUE, 'j.okafor', now() - INTERVAL '3 hours 40 minutes', 'EXECUTED',
     now() - INTERVAL '3 hours 50 minutes', now() - INTERVAL '3 hours 35 minutes'),

    -- Auto-executed: approval_required FALSE is what makes the incident read as
    -- fully automated rather than human-assisted.
    ('55555555-0003-4000-8000-000000000005', '22222222-0003-4000-8000-000000000007',
     NULL, 'API',
     'Rotate the auth-gateway leaf certificate and reload.',
     '{"endpoint": "https://gateway.internal/rotate", "reload": true}'::jsonb,
     'LOW', 0.9500, FALSE, NULL, NULL, 'EXECUTED',
     now() - INTERVAL '2 days' + INTERVAL '4 minutes', now() - INTERVAL '2 days' + INTERVAL '18 minutes'),

    -- Approved, executed, failed.
    ('55555555-0003-4000-8000-000000000006', '22222222-0003-4000-8000-000000000001',
     NULL, 'LAMBDA',
     'Restart the checkout-web edge pool in eu-west.',
     '{"function_name": "restart-edge-pool", "region": "eu-west"}'::jsonb,
     'HIGH', 0.5800, TRUE, 'm.tan', now() - INTERVAL '34 minutes', 'EXECUTED',
     now() - INTERVAL '36 minutes', now() - INTERVAL '30 minutes'),

    -- Approved, executed, rolled back. EO-1: its own bucket, never a failure.
    ('55555555-0003-4000-8000-000000000007', '22222222-0003-4000-8000-000000000009',
     NULL, 'KUBERNETES',
     'Drain the staging replay queue by restarting the consumer group.',
     '{"deployment": "notify-worker", "namespace": "staging"}'::jsonb,
     'MEDIUM', 0.8800, TRUE, 'platform-team', now() - INTERVAL '3 days' + INTERVAL '20 minutes', 'EXECUTED',
     now() - INTERVAL '3 days' + INTERVAL '15 minutes', now() - INTERVAL '3 days' + INTERVAL '52 minutes'),

    -- Approved, still running. Drives the card's live polling state.
    ('55555555-0003-4000-8000-000000000008', '22222222-0003-4000-8000-000000000005',
     NULL, 'API',
     'Trigger a partial reindex for the lagging shards.',
     '{"endpoint": "https://search.internal/reindex", "shards": "lagging"}'::jsonb,
     'LOW', 0.8300, TRUE, 'a.reyes', now() - INTERVAL '3 minutes', 'EXECUTED',
     now() - INTERVAL '6 minutes', now() - INTERVAL '3 minutes'),

    -- Rejected. The contract reuses approved_by/approved_at for rejection, and
    -- the reason lives on the developer_feedback row below.
    ('55555555-0003-4000-8000-000000000009', '22222222-0003-4000-8000-00000000000a',
     NULL, 'SQL',
     'Rebuild the search analyzer configuration table.',
     '{"statement": "TRUNCATE analyzer_config; INSERT INTO analyzer_config SELECT * FROM analyzer_config_v2"}'::jsonb,
     'HIGH', 0.2900, TRUE, 'a.reyes', now() - INTERVAL '7 hours', 'REJECTED',
     now() - INTERVAL '7 hours 30 minutes', now() - INTERVAL '7 hours')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------- executed actions
-- All four execution outcomes appear, including ROLLED_BACK, which the UI must
-- render as its own bucket rather than as a failure.
INSERT INTO executed_actions (
    id, recommended_action_id, started_at, finished_at, status,
    request_payload, response_payload, execution_logs, error_message,
    executed_by, created_at
) VALUES
    ('66666666-0003-4000-8000-000000000001', '55555555-0003-4000-8000-000000000004',
     now() - INTERVAL '3 hours 39 minutes', now() - INTERVAL '3 hours 35 minutes', 'SUCCESS',
     '{"deployment": "notify-worker", "replicas": 6}'::jsonb,
     '{"replicas_ready": 6, "lag_after": 120}'::jsonb,
     'Scaled to 6 replicas. Consumer lag fell from 41k to 120 in 4 minutes.',
     NULL, 'Execution Agent', now() - INTERVAL '3 hours 39 minutes'),

    ('66666666-0003-4000-8000-000000000002', '55555555-0003-4000-8000-000000000005',
     now() - INTERVAL '2 days' + INTERVAL '5 minutes',
     now() - INTERVAL '2 days' + INTERVAL '18 minutes', 'SUCCESS',
     '{"reload": true}'::jsonb, '{"statusCode": 200, "serial": "3f:a1:22"}'::jsonb,
     'Rotated leaf certificate. Chain verified. Gateway reloaded with zero dropped connections.',
     NULL, 'Execution Agent', now() - INTERVAL '2 days' + INTERVAL '5 minutes'),

    ('66666666-0003-4000-8000-000000000003', '55555555-0003-4000-8000-000000000006',
     now() - INTERVAL '33 minutes', now() - INTERVAL '31 minutes', 'FAILED',
     '{"function_name": "restart-edge-pool", "region": "eu-west"}'::jsonb,
     '{"statusCode": 503, "errorType": "Lambda.Timeout"}'::jsonb,
     'Invoked restart-edge-pool. Function timed out after 120s without draining.',
     'Timed out waiting for pool restart to confirm; edge still returning 503.',
     'Execution Agent', now() - INTERVAL '33 minutes'),

    ('66666666-0003-4000-8000-000000000004', '55555555-0003-4000-8000-000000000007',
     now() - INTERVAL '3 days' + INTERVAL '21 minutes',
     now() - INTERVAL '3 days' + INTERVAL '38 minutes', 'ROLLED_BACK',
     '{"deployment": "notify-worker", "namespace": "staging"}'::jsonb,
     '{"restarted": true, "rolled_back": true}'::jsonb,
     'Consumer group restarted, then re-emitted duplicates. Rolled back to the prior revision.',
     NULL, 'Execution Agent', now() - INTERVAL '3 days' + INTERVAL '21 minutes'),

    ('66666666-0003-4000-8000-000000000005', '55555555-0003-4000-8000-000000000008',
     now() - INTERVAL '2 minutes', NULL, 'RUNNING',
     '{"shards": "lagging"}'::jsonb, NULL, NULL, NULL,
     'Execution Agent', now() - INTERVAL '2 minutes')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------- incident events
-- Only event_type values the dashboard has an icon for. It renders an unknown
-- type as an unlabelled row, so inventing one here would look like a UI bug.
INSERT INTO incident_events (id, incident_id, event_type, description, payload, created_at, created_by) VALUES
    ('33333333-0003-4000-8000-000000000001', '22222222-0003-4000-8000-000000000002',
     'INCIDENT_CREATED', 'Incident raised from a Slack thread in #checkout-oncall.',
     '{"source": "Slack"}'::jsonb, now() - INTERVAL '1 hour 6 minutes', 'Incident Intake Agent'),
    ('33333333-0003-4000-8000-000000000002', '22222222-0003-4000-8000-000000000002',
     'INCIDENT_CLASSIFIED', 'Classified as Deployment / P2 · confidence 0.86.',
     '{"category": "Deployment", "priority": "P2"}'::jsonb,
     now() - INTERVAL '1 hour 6 minutes', 'Classification Agent'),
    ('33333333-0003-4000-8000-000000000003', '22222222-0003-4000-8000-000000000002',
     'RAG_SEARCH_STARTED', 'Searching the knowledge base for similar incidents.',
     '{"top_k": 8}'::jsonb, now() - INTERVAL '1 hour 5 minutes', 'RAG Retrieval Agent'),
    ('33333333-0003-4000-8000-000000000004', '22222222-0003-4000-8000-000000000002',
     'RAG_SEARCH_COMPLETED', '1 of 6 results linked to known documents · best match 0.86.',
     '{"took_ms": 210}'::jsonb, now() - INTERVAL '1 hour 4 minutes', 'RAG Retrieval Agent'),
    ('33333333-0003-4000-8000-000000000005', '22222222-0003-4000-8000-000000000002',
     'SIMILAR_INCIDENT_FOUND', 'Runbook #17 matched at 0.86 — marked as a known incident.',
     '{"knowledge_document_id": "77777777-0003-4000-8000-000000000002"}'::jsonb,
     now() - INTERVAL '1 hour 4 minutes', 'RAG Retrieval Agent'),
    ('33333333-0003-4000-8000-000000000006', '22222222-0003-4000-8000-000000000002',
     'ACTION_RECOMMENDED', 'API proposed · risk MEDIUM — purge CDN cache for tag `pricing`.',
     '{"recommended_action_id": "55555555-0003-4000-8000-000000000002"}'::jsonb,
     now() - INTERVAL '1 hour 3 minutes', 'Decision Agent'),
    ('33333333-0003-4000-8000-000000000007', '22222222-0003-4000-8000-000000000002',
     'DEVELOPER_NOTIFIED', 'Paged checkout-team — approval required for a MEDIUM risk action.',
     '{}'::jsonb, now() - INTERVAL '1 hour 2 minutes', 'system'),

    ('33333333-0003-4000-8000-000000000008', '22222222-0003-4000-8000-000000000001',
     'INCIDENT_CREATED', 'Incident received from PagerDuty alert `PD-2101`.',
     '{"source": "PagerDuty"}'::jsonb, now() - INTERVAL '38 minutes', 'Incident Intake Agent'),
    ('33333333-0003-4000-8000-000000000009', '22222222-0003-4000-8000-000000000001',
     'ESCALATED', 'Error budget burn exceeded the P1 threshold — escalated.',
     '{}'::jsonb, now() - INTERVAL '37 minutes', 'system'),
    ('33333333-0003-4000-8000-00000000000a', '22222222-0003-4000-8000-000000000001',
     'ACTION_APPROVED', 'Approved by m.tan — restart the checkout-web edge pool.',
     '{"recommended_action_id": "55555555-0003-4000-8000-000000000006"}'::jsonb,
     now() - INTERVAL '34 minutes', 'm.tan'),
    ('33333333-0003-4000-8000-00000000000b', '22222222-0003-4000-8000-000000000001',
     'ACTION_EXECUTED', 'restart-edge-pool invoked in eu-west.',
     '{"executed_action_id": "66666666-0003-4000-8000-000000000003"}'::jsonb,
     now() - INTERVAL '33 minutes', 'Execution Agent'),
    ('33333333-0003-4000-8000-00000000000c', '22222222-0003-4000-8000-000000000001',
     'VALIDATION_FAILED', 'Health probe timed out — edge still returning 503.',
     '{"agent_run_id": "44444444-0003-4000-8000-000000000005"}'::jsonb,
     now() - INTERVAL '29 minutes', 'Validation Agent'),

    ('33333333-0003-4000-8000-00000000000d', '22222222-0003-4000-8000-00000000000a',
     'INCIDENT_CREATED', 'Incident opened from the reindex pipeline API.',
     '{"source": "API"}'::jsonb, now() - INTERVAL '8 hours', 'Incident Intake Agent'),
    ('33333333-0003-4000-8000-00000000000e', '22222222-0003-4000-8000-00000000000a',
     'ACTION_REJECTED', 'Rejected by a.reyes — truncating the analyzer table is not reversible.',
     '{"recommended_action_id": "55555555-0003-4000-8000-000000000009"}'::jsonb,
     now() - INTERVAL '7 hours', 'a.reyes'),

    ('33333333-0003-4000-8000-00000000000f', '22222222-0003-4000-8000-000000000007',
     'INCIDENT_CREATED', 'Certificate expiry warning received from PagerDuty.',
     '{"source": "PagerDuty"}'::jsonb, now() - INTERVAL '2 days', 'Incident Intake Agent'),
    ('33333333-0003-4000-8000-000000000010', '22222222-0003-4000-8000-000000000007',
     'ACTION_EXECUTED', 'Certificate rotated automatically — no approval required.',
     '{"executed_action_id": "66666666-0003-4000-8000-000000000002"}'::jsonb,
     now() - INTERVAL '2 days' + INTERVAL '5 minutes', 'Execution Agent')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------ developer feedback
-- Twelve rows across four engineers. The count matters: the feedback-impact
-- widget suppresses itself entirely below ten team-wide corrections (FI-4), so
-- a thinner seed would render nothing and look broken rather than suppressed.
INSERT INTO developer_feedback (
    id, incident_id, agent_run_id, recommended_action_id, feedback_type, comments,
    corrected_category, corrected_priority, corrected_resolution, created_by, created_at
) VALUES
    ('aaaaaaaa-0003-4000-8000-000000000001', '22222222-0003-4000-8000-00000000000a',
     NULL, '55555555-0003-4000-8000-000000000009', 'REJECTED',
     'TRUNCATE on analyzer_config is not reversible and there is no snapshot staged.',
     NULL, NULL, NULL, 'a.reyes', now() - INTERVAL '7 hours'),
    ('aaaaaaaa-0003-4000-8000-000000000002', '22222222-0003-4000-8000-000000000001',
     NULL, NULL, 'CORRECTED', 'This is an API failure, not Infrastructure.',
     'API', 'P1', NULL, 'm.tan', now() - INTERVAL '35 minutes'),
    ('aaaaaaaa-0003-4000-8000-000000000003', '22222222-0003-4000-8000-000000000002',
     NULL, NULL, 'APPROVED', 'Classification looked right.',
     NULL, NULL, NULL, 'a.reyes', now() - INTERVAL '1 hour'),
    ('aaaaaaaa-0003-4000-8000-000000000004', '22222222-0003-4000-8000-000000000003',
     NULL, NULL, 'CORRECTED', 'Security, not Database — it is the token table, not the engine.',
     'Security', NULL, NULL, 'j.okafor', now() - INTERVAL '2 hours'),
    ('aaaaaaaa-0003-4000-8000-000000000005', '22222222-0003-4000-8000-000000000004',
     NULL, NULL, 'APPROVED', 'Scaling was the right call.',
     NULL, NULL, NULL, 'j.okafor', now() - INTERVAL '3 hours 30 minutes'),
    ('aaaaaaaa-0003-4000-8000-000000000006', '22222222-0003-4000-8000-000000000005',
     NULL, NULL, 'CORRECTED', 'P4 is too low while search is customer-facing.',
     NULL, 'P3', NULL, 'a.reyes', now() - INTERVAL '5 hours'),
    ('aaaaaaaa-0003-4000-8000-000000000007', '22222222-0003-4000-8000-000000000006',
     NULL, NULL, 'APPROVED', 'Matched the right runbook.',
     NULL, NULL, NULL, 'm.tan', now() - INTERVAL '3 hours'),
    ('aaaaaaaa-0003-4000-8000-000000000008', '22222222-0003-4000-8000-000000000007',
     NULL, NULL, 'APPROVED', 'Auto-execution was appropriate for a cert rotation.',
     NULL, NULL, NULL, 'l.ibarra', now() - INTERVAL '2 days'),
    ('aaaaaaaa-0003-4000-8000-000000000009', '22222222-0003-4000-8000-000000000008',
     NULL, NULL, 'CORRECTED', 'No runbook existed — this should become one.',
     NULL, NULL, 'Fix the rounding order in the tender split before summing.',
     'a.reyes', now() - INTERVAL '4 days'),
    ('aaaaaaaa-0003-4000-8000-00000000000a', '22222222-0003-4000-8000-000000000009',
     NULL, NULL, 'CORRECTED', 'Staging, not Production — the environment was wrong.',
     NULL, 'P4', NULL, 'l.ibarra', now() - INTERVAL '3 days'),
    ('aaaaaaaa-0003-4000-8000-00000000000b', '22222222-0003-4000-8000-000000000002',
     NULL, NULL, 'CORRECTED', 'Purge by tag, never a full flush — origin cannot absorb it.',
     NULL, NULL, 'Use the purge-by-tag API and verify one edge before the rest.',
     'j.okafor', now() - INTERVAL '50 minutes'),
    ('aaaaaaaa-0003-4000-8000-00000000000c', '22222222-0003-4000-8000-000000000003',
     NULL, NULL, 'APPROVED', 'Batch size of 5k is the right ceiling here.',
     NULL, NULL, NULL, 'm.tan', now() - INTERVAL '2 hours 5 minutes')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------- a proposed code change
-- The remediation for a recurring problem is often a configuration change, not
-- a command to run. Stored as a unified diff in the action's own parameters —
-- the JSONB field that already holds whatever its tool needs — so it travels
-- through the existing lazy-fetch endpoint and needs no schema of its own.
INSERT INTO recommended_actions (
    id, incident_id, agent_run_id, action_type, description, parameters,
    risk_level, confidence_score, approval_required, status, created_at, updated_at
) VALUES (
    '55555555-0003-4000-8000-00000000000a',
    '22222222-0003-4000-8000-000000000006',
    '44444444-0003-4000-8000-000000000004',
    'GITHUB_PR',
    'Raise the pgbouncer connection ceiling and add a borrow timeout.',
    jsonb_build_object(
        'repo', 'example/inventory-service',
        'branch', 'remediate/pool-ceiling-inc-2106',
        'base', 'main',
        'summary', 'Terraform plan clean · no destroy actions · rollback snapshot staged',
        'diff', concat_ws(E'\n',
            '--- a/infra/payments-db/pgbouncer.tf',
            '+++ b/infra/payments-db/pgbouncer.tf',
            '@@ -41,6 +41,7 @@',
            ' resource "aws_db_proxy" "payments" {',
            '   name = "payments-db-primary"',
            '-  max_connections_percent      = 60',
            '+  max_connections_percent      = 100',
            '-  max_idle_connections_percent = 20',
            '+  max_idle_connections_percent = 35',
            '+  connection_borrow_timeout    = 30',
            ' }'
        )
    ),
    'HIGH', 0.9100, TRUE, 'PROPOSED',
    now() - INTERVAL '3 hours 12 minutes', now() - INTERVAL '3 hours 12 minutes'
)
ON CONFLICT (id) DO NOTHING;
