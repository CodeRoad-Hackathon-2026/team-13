"""arq worker: async ingestion, source polling on a schedule, async answers.

Run with: ``arq app.worker.WorkerSettings``

The scheduler is a single cron entry that ticks every minute and dispatches the
sources that are due. Keeping the schedule in Postgres rather than in cron
entries means a source's interval can be changed through the API at runtime
without redeploying the worker.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from arq import cron

from app import providers
from app.config import settings
from app.db import close_pool, get_pool, run_migrations
from app.ingestion.pipeline import DocumentInput, ingest_document
from app.ingestion.sources import run_source
from app.queue import redis_settings
from app.rag.prompt_store import seed_defaults
from app.vault import load_vault, mark_used

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)


# --------------------------------------------------------------- job helpers
async def _job_started(job_id: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE ingestion_jobs
            SET status='running', started_at=now(), attempts = attempts + 1
            WHERE id = $1
            """,
            job_id,
        )


async def _job_finished(job_id: str, status: str, result: dict | None, error: str | None) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE ingestion_jobs
            SET status=$2, result=$3::jsonb, error=$4, finished_at=now()
            WHERE id = $1
            """,
            job_id,
            status,
            result,
            error[:2000] if error else None,
        )


# --------------------------------------------------------------------- tasks
async def ingest_document_task(ctx: dict, job_id: str, payload: dict) -> dict:
    """Embed and index a single document submitted through POST /documents."""
    await _job_started(job_id)
    try:
        result = await ingest_document(DocumentInput.from_payload(payload))
        outcome = {
            "document_id": result.document_id,
            "status": result.status,
            "chunk_count": result.chunk_count,
            "reason": result.reason,
        }
        await _job_finished(
            job_id,
            "succeeded" if result.status != "failed" else "failed",
            outcome,
            result.reason,
        )
        return outcome
    except Exception as exc:  # noqa: BLE001
        logger.exception("ingest job %s failed", job_id)
        await _job_finished(job_id, "failed", None, str(exc))
        raise


async def sync_source_task(ctx: dict, source_id: str, trigger: str = "schedule") -> dict:
    """Poll one source and ingest whatever it returned."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        source = await conn.fetchrow(
            """
            SELECT s.*, c.name AS collection_name
            FROM sources s JOIN collections c ON c.id = s.collection_id
            WHERE s.id = $1
            """,
            source_id,
        )
    if source is None:
        return {"status": "missing"}

    async with pool.acquire() as conn:
        job_id = await conn.fetchval(
            """
            INSERT INTO ingestion_jobs (collection_id, source_id, kind, status, started_at, attempts)
            VALUES ($1, $2, 'source_sync', 'running', now(), 1)
            RETURNING id
            """,
            source["collection_id"],
            source_id,
        )
        # Recorded per attempt, unlike sources.last_status which the next poll
        # overwrites. An intermittent failure is only visible in a history.
        run_id = await conn.fetchval(
            """
            INSERT INTO source_runs (source_id, trigger, status)
            VALUES ($1, $2, 'running')
            RETURNING id
            """,
            source_id,
            trigger,
        )

    started = time.perf_counter()
    try:
        # Decrypted once per poll rather than per placeholder, and only the
        # names actually referenced are marked used.
        secrets = await load_vault()
        run = await run_source(
            source["type"],
            source["collection_name"],
            source["config"] or {},
            source["cursor"] or {},
            vault=secrets,
        )
        await mark_used(secrets.used)

        counts = {"indexed": 0, "unchanged": 0, "failed": 0}
        for document in run.documents:
            result = await ingest_document(document)
            counts[result.status] = counts.get(result.status, 0) + 1

        elapsed = int((time.perf_counter() - started) * 1000)
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE sources
                SET cursor=$2::jsonb, last_run_at=now(), last_status='ok', last_error=NULL
                WHERE id=$1
                """,
                source_id,
                run.cursor,
            )
            await conn.execute(
                """
                UPDATE source_runs
                SET status='ok', finished_at=now(), duration_ms=$2,
                    documents=$3, indexed=$4, unchanged=$5, failed=$6
                WHERE id=$1
                """,
                run_id,
                elapsed,
                len(run.documents),
                counts["indexed"],
                counts["unchanged"],
                counts["failed"],
            )
        outcome = {"documents": len(run.documents), **counts, "duration_ms": elapsed}
        await _job_finished(job_id, "succeeded", outcome, None)
        logger.info("source %s synced: %s", source["name"], outcome)
        return outcome
    except Exception as exc:  # noqa: BLE001
        logger.exception("source sync failed for %s", source_id)
        elapsed = int((time.perf_counter() - started) * 1000)
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE sources
                SET last_run_at=now(), last_status='error', last_error=$2
                WHERE id=$1
                """,
                source_id,
                str(exc)[:2000],
            )
            await conn.execute(
                """
                UPDATE source_runs
                SET status='error', finished_at=now(), duration_ms=$2, error=$3
                WHERE id=$1
                """,
                run_id,
                elapsed,
                str(exc)[:2000],
            )
        await _job_finished(job_id, "failed", None, str(exc))
        raise


async def reembed_collection_task(ctx: dict, collection: str) -> dict:
    """Re-embed every document in a collection.

    Needed whenever the embedding model changes: vectors from two different
    models are not comparable, and mixing them silently destroys recall.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Re-chunk from raw_content: concatenating stored chunks would duplicate
        # overlap windows and heading prefixes into the new embeddings.
        rows = await conn.fetch(
            """
            SELECT d.external_id, d.title, d.uri, d.source_type, d.metadata,
                   d.raw_content AS content
            FROM documents d
            JOIN collections col ON col.id = d.collection_id
            WHERE col.name = $1 AND d.deleted_at IS NULL AND d.raw_content IS NOT NULL
            """,
            collection,
        )
        await conn.execute(
            "UPDATE collections SET embedding_model=$2, embedding_dim=$3 WHERE name=$1",
            collection,
            settings.embedding_model,
            settings.embedding_dim,
        )

    count = 0
    for row in rows:
        await ingest_document(
            DocumentInput(
                collection=collection,
                external_id=row["external_id"],
                content=row["content"],
                title=row["title"],
                uri=row["uri"],
                source_type=row["source_type"],
                metadata=row["metadata"] or {},
            ),
            force=True,
        )
        count += 1
    return {"reembedded": count}


async def async_answer_task(ctx: dict, request_id: str) -> dict:
    """Answer a question and POST the result to the caller's callback_url."""
    from app.rag.answer import answer_question

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM async_answers WHERE id=$1", request_id)
        if row is None:
            return {"status": "missing"}
        await conn.execute(
            "UPDATE async_answers SET status='running' WHERE id=$1", request_id
        )

    request = row["request"]
    try:
        result = await answer_question(
            request["query"],
            collections=request.get("collections"),
            filters=request.get("filters"),
            top_k=request.get("top_k"),
            agent_id=request.get("agent_id"),
            incident_id=request.get("incident_id"),
        )
        payload = {"request_id": request_id, **result.to_dict()}
        status = "succeeded"
        error = None
    except Exception as exc:  # noqa: BLE001
        logger.exception("async answer %s failed", request_id)
        payload = {"request_id": request_id, "error": str(exc)}
        status = "failed"
        error = str(exc)

    delivered = None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.post(row["callback_url"], json=payload)
        delivered = datetime.now(timezone.utc)
    except Exception:  # noqa: BLE001
        # The answer is stored regardless; the caller can still poll for it.
        logger.exception("callback delivery failed for %s", request_id)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE async_answers
            SET status=$2, response=$3::jsonb, error=$4, delivered_at=$5
            WHERE id=$1
            """,
            request_id,
            status,
            payload,
            error,
            delivered,
        )
    return {"status": status}


# ----------------------------------------------------------------- scheduler
async def scheduler_tick(ctx: dict) -> dict:
    """Enqueue every source whose interval has elapsed."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        due = await conn.fetch(
            """
            SELECT id, name FROM sources
            WHERE enabled
              AND (last_run_at IS NULL
                   OR last_run_at < now() - (interval_seconds || ' seconds')::interval)
            """
        )
    redis = ctx["redis"]
    for source in due:
        await redis.enqueue_job("sync_source_task", str(source["id"]))
    if due:
        logger.info("scheduled %d source syncs", len(due))
    return {"scheduled": len(due)}


async def prune_logs(ctx: dict) -> dict:
    """Keep query_logs bounded — it grows with every agent call.

    Pinned traces are exempt. A merged PR that links to its justification lives
    in git history forever; without this exemption that link 404s after thirty
    days, and the trace is gone exactly when an audit would want it.
    """
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.trace_retention_days)
    async with pool.acquire() as conn:
        deleted = await conn.execute(
            "DELETE FROM query_logs WHERE created_at < $1 AND NOT pinned", cutoff
        )
        # source_runs grows once per source per interval, which for a 60s
        # source is 1440 rows a day. Same retention, no pinning.
        runs = await conn.execute(
            "DELETE FROM source_runs WHERE started_at < $1", cutoff
        )
    return {"query_logs": deleted, "source_runs": runs}


# ------------------------------------------------------------------- startup
async def startup(ctx: dict) -> None:
    logging.basicConfig(level=settings.log_level)
    await run_migrations()
    await seed_defaults()
    logger.info("worker ready (embeddings=%s, llm=%s)", settings.embedding_provider, settings.llm_provider)


async def shutdown(ctx: dict) -> None:
    await providers.close_providers()
    await close_pool()


class WorkerSettings:
    functions = [
        ingest_document_task,
        sync_source_task,
        reembed_collection_task,
        async_answer_task,
    ]
    cron_jobs = [
        cron(scheduler_tick, second=0, run_at_startup=True),
        cron(prune_logs, hour=3, minute=30),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = redis_settings()
    max_jobs = settings.worker_concurrency
    job_timeout = 900
    max_tries = settings.job_max_attempts
