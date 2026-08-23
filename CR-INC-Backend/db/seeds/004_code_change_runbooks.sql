-- Runbooks whose remediation IS a code or configuration change.
--
-- The runbooks in 002/003 describe a fix in prose ("raise the pool size and
-- redeploy"), so the Decision Agent has to invent the file, the setting and the
-- value before it can emit a GITHUB_PR diff. It does — and the diff comes out
-- add-only, duplicating the key instead of replacing it, because there is
-- nothing to anchor a replacement to.
--
-- These carry what the planner's own prompt asks for and the others do not:
--
--   * the repository as org/repo, so resolve_repo() has a slug it can parse —
--     a bare service name is refused, which is correct and a useless demo;
--   * the file excerpt WITH line numbers, because app/agents/decision.py says
--     "Use the real line numbers the runbook shows";
--   * old and new values side by side, so the patch replaces rather than appends.
--
-- Also written to be *matched*: each repeats the vocabulary an alert for it would
-- carry (the error code, the endpoint, the job name). The corpus is small, so word
-- overlap decides whether the Decision Agent abstains — Runbook #58 scores 0.82
-- against its own alert, where the prose-only runbooks score 0.56.
--
-- Idempotent and editable: DO UPDATE, so correcting the text here and re-running
-- ./db/migrate.sh --seed (then python -m app.corpus) actually takes effect.
-- Dollar-quoted so the file excerpts can hold real newlines and apostrophes.

INSERT INTO knowledge_documents
    (id, title, summary, content, document_type, source, source_id, source_url, service_id)
VALUES
(
    '77777777-0004-4000-8000-000000000001',
    'Runbook #58 — checkout-web upstream timeout cascade',
    'ERR_UPSTREAM_TIMEOUT on /checkout: lower the payments-api client timeout and retries in config/http_clients.yml. Do not scale checkout-web first.',
    $doc$Symptoms: ERR_UPSTREAM_TIMEOUT in the checkout-web logs, 5xx rate above 5% on /checkout, p99 latency above 3 seconds.

Diagnosis: the outbound HTTP client to payments-api is configured with read_timeout_seconds 30 and max_retries 3, so one slow upstream call occupies a worker for up to 90 seconds and the worker pool starves. The 5xx are checkout-web running out of workers, not payments-api returning errors.

Repository: example/checkout-web (base branch main).

config/http_clients.yml, lines 12-16, currently reads:

    12  payments_api:
    13    base_url: http://payments-api.internal
    14    read_timeout_seconds: 30
    15    max_retries: 3
    16    circuit_breaker: false

Remediation: replace line 14 with "  read_timeout_seconds: 5" and line 15 with "  max_retries: 1". Both are edits, not additions: leaving the old values in place gives the config loader a duplicate key. Then redeploy checkout-web.

Do not scale checkout-web first. Adding replicas multiplies the concurrent calls into an upstream that is already slow and makes the cascade worse. INC-2481 is 42 minutes of evidence for that.$doc$,
    'RUNBOOK', 'wiki', 'runbook-58',
    'https://wiki.example.com/runbooks/58',
    '11111111-0003-4000-8000-000000000001'
),
(
    '77777777-0004-4000-8000-000000000002',
    'Runbook #61 — inventory-service N+1 lookup in the sync batch job',
    'The inventory sync batch job fetches each warehouse row inside the loop. Hoist the lookup in app/jobs/inventory_sync.py.',
    $doc$Symptoms: the inventory sync batch job runtime climbs past 20 minutes, thousands of single-row SELECTs against warehouses per run, and lock contention or deadlock on the inventory_sync table.

Diagnosis: an N+1 query. The per-item loop loads each item's warehouse row separately, so a run of 8000 items issues 8000 lookups and holds its transaction open for the whole batch.

Repository: example/inventory-service (base branch main).

app/jobs/inventory_sync.py, lines 41-46, currently reads:

    41  for item in batch:
    42      warehouse = fetch_warehouse(item.warehouse_id)
    43      item.location = warehouse.location
    44      item.region = warehouse.region
    45      session.add(item)
    46  session.commit()

Remediation: hoist the lookup out of the loop. Insert before line 41: "warehouses = fetch_warehouses({item.warehouse_id for item in batch})". Replace line 42 with "    warehouse = warehouses[item.warehouse_id]". One query per batch instead of one per item.

Raising the statement timeout does not fix this. It only lets the same job run longer while holding the same locks.$doc$,
    'RUNBOOK', 'wiki', 'runbook-61',
    'https://wiki.example.com/runbooks/61',
    '11111111-1111-1111-1111-111111111112'
)
ON CONFLICT (id) DO UPDATE SET
    title         = EXCLUDED.title,
    summary       = EXCLUDED.summary,
    content       = EXCLUDED.content,
    document_type = EXCLUDED.document_type,
    source        = EXCLUDED.source,
    source_id     = EXCLUDED.source_id,
    source_url    = EXCLUDED.source_url,
    service_id    = EXCLUDED.service_id,
    updated_at    = now();
