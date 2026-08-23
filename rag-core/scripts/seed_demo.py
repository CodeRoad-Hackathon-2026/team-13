"""Seed a demo corpus: runbooks + resolved incidents.

    python -m scripts.seed_demo

Runs against the configured database directly (no HTTP), so it works before the
API is up. Uses the same ingestion pipeline the API uses.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app.db import close_pool, run_migrations
from app.ingestion.pipeline import DocumentInput, ensure_collection, ingest_document

NOW = datetime.now(timezone.utc)

RUNBOOKS = [
    {
        "external_id": "runbook/payments-timeout",
        "title": "Payments API timeouts",
        "metadata": {"service": "payments-api", "team": "payments", "kind": "runbook"},
        "content": """# Payments API timeouts

## Symptom
Checkout requests fail with `ERR_UPSTREAM_TIMEOUT` and p99 latency on
`payments-api` exceeds 8s. The `payment_gateway_latency_seconds` histogram
shows the tail moving before the error rate does.

## Immediate mitigation
1. Check the connection pool: `kubectl exec -n payments deploy/payments-api -- \\
   curl -s localhost:9090/metrics | grep pgbouncer_pools_cl_waiting`.
2. If `cl_waiting` is above 20, the pool is saturated. Scale pgbouncer first,
   not the API: `kubectl scale -n payments deploy/pgbouncer --replicas=6`.
3. Only after pgbouncer is healthy, scale the API to 12 replicas.

## Root cause pattern
The most common cause is a long-running analytics query holding connections.
Find it with `SELECT pid, now() - query_start AS age, query FROM pg_stat_activity
WHERE state = 'active' ORDER BY age DESC LIMIT 10;` and terminate anything
older than 5 minutes with `SELECT pg_terminate_backend(pid);`.

## Do not
Do not restart the primary database. A failover during checkout traffic causes
duplicate charges because the idempotency cache is in-memory.
""",
    },
    {
        "external_id": "runbook/rollback",
        "title": "Rolling back a bad deploy",
        "metadata": {"service": "platform", "team": "sre", "kind": "runbook"},
        "content": """# Rolling back a bad deploy

## When to roll back
Roll back immediately if error rate exceeds 2% for 5 minutes after a deploy.
Do not spend time debugging forward during business hours.

## Procedure
1. Identify the previous good revision: `kubectl rollout history deploy/<svc> -n <ns>`.
2. Roll back: `kubectl rollout undo deploy/<svc> -n <ns> --to-revision=<n>`.
3. Watch: `kubectl rollout status deploy/<svc> -n <ns> --timeout=300s`.
4. Post in `#incidents` with the revision number and the reason.

## Database migrations
If the deploy included a migration, a rollback of the code alone is unsafe when
the migration was destructive (dropped column, renamed table). Check
`migrations/` in the release tag first. Additive migrations are always safe to
leave in place.
""",
    },
]

INCIDENTS = [
    {
        "external_id": "INC-2481",
        "title": "INC-2481 Checkout 5xx spike after payments-api v4.12",
        "metadata": {
            "service": "payments-api",
            "severity": "P1",
            "kind": "incident",
            "status": "resolved",
        },
        "days_ago": 12,
        "content": """# INC-2481 — Checkout 5xx spike

**Severity:** P1  **Duration:** 42 minutes  **Service:** payments-api

## Timeline
- 14:02 Deploy of payments-api v4.12 completed.
- 14:09 Error rate crossed 2%; `ERR_UPSTREAM_TIMEOUT` on 30% of checkout calls.
- 14:15 On-call scaled payments-api to 20 replicas. No improvement.
- 14:24 pgbouncer `cl_waiting` found at 84. Root cause identified.
- 14:31 Scaled pgbouncer 2 -> 8 replicas. Errors dropped within 90 seconds.
- 14:44 Declared resolved.

## Root cause
v4.12 added an eager `JOIN` on `order_history` to the checkout read path,
tripling connections held per request. The API pool was fine; pgbouncer was the
bottleneck. Scaling the API made it worse by increasing pool pressure.

## Resolution
Scaled pgbouncer, then reverted the eager join in v4.12.1.

## Lesson
When checkout times out, check pgbouncer `cl_waiting` before scaling the API.
Scaling the API first amplifies pool saturation.
""",
    },
    {
        "external_id": "INC-2510",
        "title": "INC-2510 Search index stale after Kafka consumer lag",
        "metadata": {
            "service": "search-indexer",
            "severity": "P2",
            "kind": "incident",
            "status": "resolved",
        },
        "days_ago": 4,
        "content": """# INC-2510 — Stale search results

**Severity:** P2  **Service:** search-indexer

## Symptom
Products updated in the last 6 hours did not appear in search. No errors in
logs; the indexer looked healthy.

## Root cause
The `product-updates` Kafka consumer group had a lag of 1.2M messages after a
rebalance left two partitions unassigned. `kafka-consumer-groups.sh --describe
--group search-indexer` showed CURRENT-OFFSET frozen on partitions 3 and 7.

## Resolution
Restarted the indexer pods to force a clean rebalance:
`kubectl rollout restart deploy/search-indexer -n search`. Lag drained in
18 minutes.

## Detection gap
There was no alert on consumer lag. Added `kafka_consumergroup_lag > 100000
for 10m` to the SRE alert bundle.
""",
    },
]


async def main() -> None:
    await run_migrations()

    await ensure_collection("runbooks", "Operational runbooks and procedures")
    await ensure_collection("incidents", "Resolved incident postmortems")

    for doc in RUNBOOKS:
        result = await ingest_document(
            DocumentInput(
                collection="runbooks",
                external_id=doc["external_id"],
                content=doc["content"],
                title=doc["title"],
                source_type="seed",
                metadata=doc["metadata"],
            )
        )
        print(f"runbooks/{doc['external_id']}: {result.status} ({result.chunk_count} chunks)")

    for doc in INCIDENTS:
        result = await ingest_document(
            DocumentInput(
                collection="incidents",
                external_id=doc["external_id"],
                content=doc["content"],
                title=doc["title"],
                source_type="seed",
                metadata=doc["metadata"],
                source_created_at=NOW - timedelta(days=doc["days_ago"]),
                source_updated_at=NOW - timedelta(days=doc["days_ago"]),
            )
        )
        print(f"incidents/{doc['external_id']}: {result.status} ({result.chunk_count} chunks)")

    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
