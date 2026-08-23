-- 002_demo_data.sql
-- OPTIONAL demo data: one full incident lifecycle so the dashboard views and the
-- RAG queries return something before the agents are wired up. Safe to re-run.
-- Fixed UUIDs keep it idempotent. Do not load this in a shared/real environment.

INSERT INTO services (id, name, description, owner, repository_url, environment) VALUES
    ('11111111-1111-1111-1111-111111111111', 'payments-api',
     'Handles payment authorization and capture.', 'payments-team',
     'https://github.com/example/payments-api', 'Production'),
    ('11111111-1111-1111-1111-111111111112', 'inventory-service',
     'Vehicle inventory read/write service.', 'inventory-team',
     'https://github.com/example/inventory-service', 'Production')
ON CONFLICT (id) DO NOTHING;

-- A known incident, already resolved through automation.
INSERT INTO incidents (
    id, external_id, title, description, status, priority, category, source,
    service_id, environment, assigned_to, is_known_incident, confidence_score,
    created_at, resolved_at, resolution_summary
) VALUES (
    '22222222-2222-2222-2222-222222222221',
    'PD-1001',
    'payments-api 5xx spike — connection pool exhausted',
    'Alert: error rate 12% on POST /v1/payments. Database connection pool saturated.',
    'RESOLVED', 'P1', 'Database', 'PagerDuty',
    '11111111-1111-1111-1111-111111111111', 'Production', 'payments-team',
    TRUE, 0.9400,
    now() - INTERVAL '2 hours', now() - INTERVAL '1 hour',
    'Recycled idle connections and raised pool size from 20 to 50. Error rate back to baseline.'
),
-- An unknown incident, still open and awaiting developer review.
(
    '22222222-2222-2222-2222-222222222222',
    'EMAIL-2044',
    'inventory-service latency degradation after deploy',
    'Customers report slow vehicle searches since release 4.12.0.',
    'INVESTIGATING', 'P2', 'Deployment', 'Email',
    '11111111-1111-1111-1111-111111111112', 'Production', NULL,
    FALSE, 0.4100,
    now() - INTERVAL '25 minutes', NULL, NULL
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incident_events (id, incident_id, event_type, description, payload, created_at, created_by) VALUES
    ('33333333-3333-3333-3333-333333333331', '22222222-2222-2222-2222-222222222221',
     'INCIDENT_CREATED', 'Incident created from PagerDuty alert.',
     '{"source": "PagerDuty", "external_id": "PD-1001"}'::jsonb,
     now() - INTERVAL '2 hours', 'Incident Intake Agent'),
    ('33333333-3333-3333-3333-333333333332', '22222222-2222-2222-2222-222222222221',
     'INCIDENT_CLASSIFIED', 'Classified as Database / P1.',
     '{"category": "Database", "priority": "P1"}'::jsonb,
     now() - INTERVAL '119 minutes', 'Classification Agent'),
    ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222221',
     'SIMILAR_INCIDENT_FOUND', 'Matched runbook "Connection pool exhaustion" at 0.93.',
     '{"similarity_score": 0.93}'::jsonb,
     now() - INTERVAL '118 minutes', 'RAG Retrieval Agent'),
    ('33333333-3333-3333-3333-333333333334', '22222222-2222-2222-2222-222222222221',
     'ACTION_EXECUTED', 'Lambda recycle-idle-connections executed successfully.',
     '{"lambda": "recycle-idle-connections", "status": "SUCCESS"}'::jsonb,
     now() - INTERVAL '70 minutes', 'Execution Agent'),
    ('33333333-3333-3333-3333-333333333335', '22222222-2222-2222-2222-222222222221',
     'RESOLVED', 'Error rate back to baseline; incident resolved.',
     '{}'::jsonb, now() - INTERVAL '1 hour', 'Validation Agent'),
    ('33333333-3333-3333-3333-333333333336', '22222222-2222-2222-2222-222222222222',
     'INCIDENT_CREATED', 'Incident created from inbound email.',
     '{"source": "Email"}'::jsonb, now() - INTERVAL '25 minutes', 'Incident Intake Agent'),
    ('33333333-3333-3333-3333-333333333337', '22222222-2222-2222-2222-222222222222',
     'DEVELOPER_NOTIFIED', 'No similar incident found; developer review requested.',
     '{"channel": "slack", "target": "#inventory-oncall"}'::jsonb,
     now() - INTERVAL '20 minutes', 'Decision Agent')
ON CONFLICT (id) DO NOTHING;

-- Agent runs reference the seeded registry by name (seeds/001_agents.sql must run first).
INSERT INTO agent_runs (
    id, incident_id, agent_id, status, input, output, confidence_score,
    started_at, finished_at, tokens_input, tokens_output, latency_ms, model, prompt_version
)
SELECT
    '44444444-4444-4444-4444-444444444441',
    '22222222-2222-2222-2222-222222222221',
    a.id, 'SUCCESS',
    '{"title": "payments-api 5xx spike"}'::jsonb,
    '{"category": "Database", "priority": "P1"}'::jsonb,
    0.9400,
    now() - INTERVAL '119 minutes', now() - INTERVAL '118 minutes',
    1420, 260, 2100, 'claude-sonnet-5', 'v1'
FROM agents a WHERE a.name = 'Classification Agent'
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_runs (
    id, incident_id, agent_id, status, input, output, confidence_score,
    started_at, finished_at, tokens_input, tokens_output, latency_ms, model, prompt_version
)
SELECT
    '44444444-4444-4444-4444-444444444442',
    '22222222-2222-2222-2222-222222222221',
    a.id, 'SUCCESS',
    '{"query": "payments-api connection pool exhausted"}'::jsonb,
    '{"matches": 3, "best_score": 0.93}'::jsonb,
    0.9300,
    now() - INTERVAL '118 minutes', now() - INTERVAL '117 minutes',
    980, 140, 1500, 'claude-sonnet-5', 'v1'
FROM agents a WHERE a.name = 'RAG Retrieval Agent'
ON CONFLICT (id) DO NOTHING;

INSERT INTO recommended_actions (
    id, incident_id, agent_run_id, action_type, description, parameters,
    risk_level, confidence_score, approval_required, approved_by, approved_at, status,
    created_at, updated_at
) VALUES (
    '55555555-5555-5555-5555-555555555551',
    '22222222-2222-2222-2222-222222222221',
    '44444444-4444-4444-4444-444444444442',
    'LAMBDA',
    'Invoke recycle-idle-connections and raise the pool size to 50.',
    '{"function_name": "recycle-idle-connections", "pool_size": 50}'::jsonb,
    'MEDIUM', 0.9100, TRUE, 'miguel.frade@coxautoinc.com', now() - INTERVAL '75 minutes',
    'EXECUTED',
    -- Explicit: defaulting these to now() made the action younger than its own
    -- approval and execution.
    now() - INTERVAL '100 minutes', now() - INTERVAL '70 minutes'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO executed_actions (
    id, recommended_action_id, started_at, finished_at, status,
    request_payload, response_payload, execution_logs, executed_by, created_at
) VALUES (
    '66666666-6666-6666-6666-666666666661',
    '55555555-5555-5555-5555-555555555551',
    now() - INTERVAL '71 minutes', now() - INTERVAL '70 minutes', 'SUCCESS',
    '{"function_name": "recycle-idle-connections"}'::jsonb,
    '{"statusCode": 200, "recycled": 18}'::jsonb,
    'Recycled 18 idle connections. Pool size updated to 50.',
    'Execution Agent', now() - INTERVAL '71 minutes'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_documents (
    id, title, summary, content, document_type, source, source_url, source_id, incident_id
) VALUES (
    '77777777-7777-7777-7777-777777777771',
    'Runbook: database connection pool exhaustion',
    'Symptoms, diagnosis and remediation for pool saturation on the payments stack.',
    'Symptoms: 5xx spike on write endpoints, pool wait time above 500ms. '
    'Diagnosis: check active vs idle connections. '
    'Remediation: recycle idle connections, then raise the pool size and redeploy.',
    'RUNBOOK', 'Confluence', 'https://example.com/runbooks/pool-exhaustion', 'RB-42', NULL
),
(
    '77777777-7777-7777-7777-777777777772',
    'Postmortem: payments-api outage 2026-05-14',
    'Same failure mode, resolved by recycling idle connections.',
    'Root cause: a long-running report query held connections open. '
    'Fix: statement timeout plus a larger pool.',
    'POSTMORTEM', 'GitHub', 'https://example.com/postmortems/2026-05-14', 'PM-14',
    '22222222-2222-2222-2222-222222222221'
)
ON CONFLICT (id) DO NOTHING;

-- Placeholder embeddings so the HNSW index and the retrieval query are exercised
-- end to end. Replace with real vectors from the embedding model.
INSERT INTO knowledge_embeddings (knowledge_document_id, chunk_index, content, embedding)
SELECT
    '77777777-7777-7777-7777-777777777771', 0,
    'Remediation: recycle idle connections, then raise the pool size and redeploy.',
    ('[' || (SELECT string_agg('0.001', ',') FROM generate_series(1, 1536)) || ']')::vector
ON CONFLICT (knowledge_document_id, chunk_index) DO NOTHING;

INSERT INTO similarity_matches (
    id, incident_id, knowledge_document_id, similarity_score, match_type
) VALUES
    ('88888888-8888-8888-8888-888888888881', '22222222-2222-2222-2222-222222222221',
     '77777777-7777-7777-7777-777777777771', 0.93000, 'SEMANTIC'),
    ('88888888-8888-8888-8888-888888888882', '22222222-2222-2222-2222-222222222221',
     '77777777-7777-7777-7777-777777777772', 0.89000, 'SEMANTIC')
ON CONFLICT (id) DO NOTHING;

INSERT INTO developer_feedback (
    id, incident_id, agent_run_id, feedback_type, comments, created_by
) VALUES (
    '99999999-9999-9999-9999-999999999991',
    '22222222-2222-2222-2222-222222222221',
    '44444444-4444-4444-4444-444444444441',
    'APPROVED', 'Classification and remediation were both correct.',
    'miguel.frade@coxautoinc.com'
)
ON CONFLICT (id) DO NOTHING;
