"""REST surface consumed by the incident agents."""

from __future__ import annotations

import json
import logging
import time
from datetime import timedelta

import asyncpg

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app import providers
from app.config import settings
from app.db import get_pool
from app.ingestion.pipeline import (
    DocumentInput,
    delete_document,
    ensure_collection,
    ingest_document,
)
from app.ingestion.sources import SOURCE_SPECS, run_check
from app.queue import enqueue
from app.rag import prompt_store
from app.rag.answer import answer_question, stream_answer
from app.retrieval.hybrid import hybrid_search, rerank_candidates
from app.schemas import (
    AnswerAccepted,
    AnswerRequest,
    ApiKeyIn,
    ApiKeyOut,
    CollectionCreate,
    CollectionOut,
    DocumentBatchIn,
    DocumentIn,
    FeedbackIn,
    IngestAccepted,
    PromptSaveIn,
    SearchRequest,
    SearchResponse,
    SecretIn,
    SecretOut,
    SourceIn,
    SourceOut,
    SourceRunOut,
    SourceTestIn,
    SourceTestOut,
    SourceUpdate,
    TracePinIn,
)
from app.security import ApiKeyContext, create_api_key, get_api_key, require_scope
from app.vault import (
    VaultError,
    delete_secret,
    list_secrets,
    load_vault,
    put_secret,
    redact,
    vault_enabled,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ------------------------------------------------------------------ health
@router.get("/health", tags=["ops"])
async def health() -> dict:
    checks: dict[str, str] = {}
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["postgres"] = f"error: {exc}"

    from app.queue import get_redis

    redis = await get_redis()
    checks["redis"] = "ok" if redis is not None else "unavailable"

    healthy = checks["postgres"] == "ok"
    return {
        "status": "ok" if healthy else "degraded",
        "checks": checks,
        "providers": {
            "embeddings": f"{settings.embedding_provider}:{settings.embedding_model}",
            "llm": f"{settings.llm_provider}:{settings.llm_model}",
            "rerank": settings.rerank_provider if settings.rerank_enabled else "disabled",
        },
    }


# ------------------------------------------------------------- collections
@router.post(
    "/collections",
    response_model=CollectionOut,
    status_code=status.HTTP_201_CREATED,
    tags=["collections"],
)
async def create_collection(
    payload: CollectionCreate, _: ApiKeyContext = Depends(require_scope("write"))
) -> CollectionOut:
    row = await ensure_collection(payload.name, payload.description, payload.metadata)
    return CollectionOut(
        id=str(row["id"]),
        name=row["name"],
        description=row["description"],
        embedding_model=row["embedding_model"],
        embedding_dim=row["embedding_dim"],
        created_at=row["created_at"],
    )


@router.get("/collections", response_model=list[CollectionOut], tags=["collections"])
async def list_collections(_: ApiKeyContext = Depends(get_api_key)) -> list[CollectionOut]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.*,
                   (SELECT count(*) FROM documents d
                     WHERE d.collection_id = c.id AND d.deleted_at IS NULL) AS document_count,
                   (SELECT count(*) FROM chunks ch WHERE ch.collection_id = c.id) AS chunk_count
            FROM collections c
            ORDER BY c.name
            """
        )
    return [
        CollectionOut(
            id=str(r["id"]),
            name=r["name"],
            description=r["description"],
            embedding_model=r["embedding_model"],
            embedding_dim=r["embedding_dim"],
            document_count=r["document_count"],
            chunk_count=r["chunk_count"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.delete("/collections/{name}", tags=["collections"])
async def drop_collection(
    name: str, _: ApiKeyContext = Depends(require_scope("admin"))
) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        deleted = await conn.fetchval(
            "DELETE FROM collections WHERE name = $1 RETURNING id", name
        )
    if deleted is None:
        raise HTTPException(status_code=404, detail=f"collection '{name}' not found")
    return {"deleted": name}


@router.post("/collections/{name}/reembed", tags=["collections"])
async def reembed_collection(
    name: str, _: ApiKeyContext = Depends(require_scope("admin"))
) -> dict:
    """Re-embed a collection after an embedding-model change."""
    job_id = await enqueue("reembed_collection_task", name)
    if job_id is None:
        raise HTTPException(status_code=503, detail="worker queue unavailable")
    return {"job_id": job_id, "collection": name}


# ---------------------------------------------------------------- ingestion
async def _record_job(collection: str, payload: dict) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        collection_id = await conn.fetchval(
            "SELECT id FROM collections WHERE name = $1", collection
        )
        if collection_id is None:
            raise HTTPException(
                status_code=404, detail=f"collection '{collection}' does not exist"
            )
        return str(
            await conn.fetchval(
                """
                INSERT INTO ingestion_jobs (collection_id, kind, status, payload)
                VALUES ($1, 'document', 'queued', $2::jsonb)
                RETURNING id
                """,
                collection_id,
                payload,
            )
        )


@router.post(
    "/documents",
    response_model=IngestAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["ingestion"],
)
async def ingest_documents(
    payload: DocumentBatchIn, _: ApiKeyContext = Depends(require_scope("write"))
) -> IngestAccepted:
    """Generic ingestion endpoint — every connector ultimately lands here."""
    job_ids: list[str] = []
    results: list[dict] = []

    for document in payload.documents:
        body = json.loads(document.model_dump_json())
        if payload.mode == "sync":
            result = await ingest_document(DocumentInput.from_payload(body))
            results.append(
                {
                    "external_id": document.external_id,
                    "document_id": result.document_id,
                    "status": result.status,
                    "chunk_count": result.chunk_count,
                    "reason": result.reason,
                }
            )
            continue

        job_id = await _record_job(document.collection, body)
        enqueued = await enqueue("ingest_document_task", job_id, body)
        if enqueued is None:
            # No worker reachable — degrade to synchronous rather than silently
            # dropping the document.
            result = await ingest_document(DocumentInput.from_payload(body))
            results.append(
                {
                    "external_id": document.external_id,
                    "document_id": result.document_id,
                    "status": result.status,
                    "chunk_count": result.chunk_count,
                    "degraded": "queue unavailable, ingested synchronously",
                }
            )
        else:
            job_ids.append(job_id)

    return IngestAccepted(
        accepted=len(payload.documents),
        mode=payload.mode,
        job_ids=job_ids,
        results=results,
    )


@router.delete("/documents/{collection}/{external_id:path}", tags=["ingestion"])
async def remove_document(
    collection: str, external_id: str, _: ApiKeyContext = Depends(require_scope("write"))
) -> dict:
    if not await delete_document(collection, external_id):
        raise HTTPException(status_code=404, detail="document not found")
    return {"deleted": external_id, "collection": collection}


@router.get("/jobs/{job_id}", tags=["ingestion"])
async def job_status(job_id: str, _: ApiKeyContext = Depends(get_api_key)) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM ingestion_jobs WHERE id = $1", job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return {
        "id": str(row["id"]),
        "kind": row["kind"],
        "status": row["status"],
        "attempts": row["attempts"],
        "result": row["result"],
        "error": row["error"],
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
    }


# ------------------------------------------------------------------ search
@router.post("/search", response_model=SearchResponse, tags=["retrieval"])
async def search(
    payload: SearchRequest, _: ApiKeyContext = Depends(get_api_key)
) -> SearchResponse:
    """Retrieval only — no generation, no tokens spent on an LLM.

    This is the endpoint an agent should call when it wants evidence to reason
    over itself rather than a prose answer.
    """
    started = time.perf_counter()
    candidates = await hybrid_search(
        payload.query, collections=payload.collections, filters=payload.filters
    )
    if payload.rerank:
        candidates = await rerank_candidates(payload.query, candidates, payload.top_k)
    else:
        candidates = candidates[: payload.top_k]
    return SearchResponse(
        query=payload.query,
        results=[c.to_dict() for c in candidates],
        took_ms=int((time.perf_counter() - started) * 1000),
    )


# ------------------------------------------------------------------ answer
def _check_incident_id(payload: AnswerRequest) -> None:
    """Enforce the correlation id that makes an incident reconstructable.

    Rejected at the edge rather than defaulted to something generated: an
    auto-filled id groups nothing, and the caller would never learn it was
    supposed to send one. The trace only becomes findable if the orchestrator
    passes the id it already has.
    """
    if settings.require_incident_id and not (payload.incident_id or "").strip():
        raise HTTPException(
            status_code=422,
            detail=(
                "incident_id is required. It is the correlation id that makes "
                "GET /v1/incidents/{id}/traces able to reconstruct everything "
                "asked during one incident — without it this call is "
                "unfindable afterwards. Set REQUIRE_INCIDENT_ID=false for "
                "exploratory use where no incident exists."
            ),
        )


@router.post("/answer", tags=["rag"])
async def answer(
    payload: AnswerRequest, key: ApiKeyContext = Depends(get_api_key)
) -> dict:
    """Grounded answer with citations.

    With ``callback_url`` set, returns 202 immediately and POSTs the result to
    that URL when it is ready — for long incident investigations where an agent
    should not hold a connection open.
    """
    _check_incident_id(payload)
    if payload.callback_url:
        pool = await get_pool()
        async with pool.acquire() as conn:
            request_id = str(
                await conn.fetchval(
                    """
                    INSERT INTO async_answers (request, callback_url)
                    VALUES ($1::jsonb, $2)
                    RETURNING id
                    """,
                    json.loads(payload.model_dump_json(exclude={"callback_url"})),
                    str(payload.callback_url),
                )
            )
        if await enqueue("async_answer_task", request_id) is None:
            raise HTTPException(status_code=503, detail="worker queue unavailable")
        return AnswerAccepted(
            request_id=request_id,
            status="queued",
            callback_url=str(payload.callback_url),
        ).model_dump()

    result = await answer_question(
        payload.query,
        collections=payload.collections,
        filters=payload.filters,
        top_k=payload.top_k,
        api_key_id=key.id,
        agent_id=payload.agent_id,
        incident_id=payload.incident_id,
    )
    return result.to_dict()


@router.post("/answer/stream", tags=["rag"])
async def answer_stream(
    payload: AnswerRequest, key: ApiKeyContext = Depends(get_api_key)
) -> StreamingResponse:
    """Server-Sent Events: `sources`, then `delta`*, then `final` and `done`.

    Validation results (citations, groundedness, warnings) arrive in `final` —
    the streamed deltas are unverified text by construction.
    """
    # Raised before the StreamingResponse is constructed, so the caller gets a
    # real 422. Raising inside the generator would send 200 and then an SSE
    # error frame, which most clients surface as a generation failure.
    _check_incident_id(payload)

    async def event_source():
        async for event in stream_answer(
            payload.query,
            collections=payload.collections,
            filters=payload.filters,
            top_k=payload.top_k,
            api_key_id=key.id,
            agent_id=payload.agent_id,
            incident_id=payload.incident_id,
        ):
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'], default=str)}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/answer/{request_id}", tags=["rag"])
async def async_answer_result(
    request_id: str, _: ApiKeyContext = Depends(get_api_key)
) -> dict:
    """Poll an async answer, for callers whose callback did not arrive."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM async_answers WHERE id = $1", request_id)
    if row is None:
        raise HTTPException(status_code=404, detail="request not found")
    return {
        "request_id": request_id,
        "status": row["status"],
        "response": row["response"],
        "error": row["error"],
        "delivered_at": row["delivered_at"],
    }


# ---------------------------------------------------------------- feedback
@router.post("/feedback", status_code=status.HTTP_201_CREATED, tags=["rag"])
async def submit_feedback(
    payload: FeedbackIn, _: ApiKeyContext = Depends(get_api_key)
) -> dict:
    """Record whether a retrieved chunk actually helped.

    Feeds ``chunk_feedback_scores``, which multiplicatively adjusts the fusion
    score on subsequent searches.
    """
    if not (payload.chunk_id or payload.document_id or payload.query_log_id):
        raise HTTPException(
            status_code=422,
            detail="one of chunk_id, document_id, or query_log_id is required",
        )
    pool = await get_pool()
    async with pool.acquire() as conn:
        feedback_id = await conn.fetchval(
            """
            INSERT INTO feedback (query_log_id, chunk_id, document_id, rating, reason, agent_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            """,
            payload.query_log_id,
            payload.chunk_id,
            payload.document_id,
            payload.rating,
            payload.reason,
            payload.agent_id,
        )
    return {"id": str(feedback_id), "recorded": True}


@router.get("/traces/{query_log_id}", tags=["rag"])
async def get_trace(
    query_log_id: str, _: ApiKeyContext = Depends(get_api_key)
) -> dict:
    """Full trace of one query: retrieved chunks, answer, citations, verdict."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM query_logs WHERE id = $1", query_log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="trace not found")
    return {k: row[k] for k in row.keys()} | {"id": str(row["id"])}


@router.post("/traces/{query_log_id}/pin", tags=["rag"])
async def pin_trace(
    query_log_id: str,
    payload: TracePinIn,
    _: ApiKeyContext = Depends(require_scope("write")),
) -> dict:
    """Exempt a trace from retention pruning.

    Call this whenever a trace is referenced from something durable — a PR body,
    a postmortem, an audit record. Those outlive the retention window, and an
    unpinned trace they link to will be gone.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE query_logs
            SET pinned = true, pinned_at = now(), pin_reason = $2
            WHERE id = $1
            RETURNING id, pinned_at, pin_reason
            """,
            query_log_id,
            payload.reason,
        )
    if row is None:
        raise HTTPException(status_code=404, detail="trace not found")
    return {"id": str(row["id"]), "pinned": True, "pinned_at": row["pinned_at"],
            "reason": row["pin_reason"]}


@router.delete("/traces/{query_log_id}/pin", tags=["rag"])
async def unpin_trace(
    query_log_id: str, _: ApiKeyContext = Depends(require_scope("write"))
) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE query_logs SET pinned = false, pinned_at = NULL, pin_reason = NULL
            WHERE id = $1 RETURNING id
            """,
            query_log_id,
        )
    if row is None:
        raise HTTPException(status_code=404, detail="trace not found")
    return {"id": str(row["id"]), "pinned": False}


@router.get("/incidents/{incident_id}/traces", tags=["rag"])
async def incident_traces(
    incident_id: str, _: ApiKeyContext = Depends(get_api_key)
) -> dict:
    """Every query made while working one incident, oldest first.

    This is the endpoint the PR-viewer app calls to reconstruct the reasoning
    chain: what was asked, in what order, what was retrieved, and where the
    agent abstained rather than guessing.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, agent_id, query, answer, abstained, abstain_reason,
                   citations, groundedness, llm_model, latency_ms, pinned,
                   prompt_versions, created_at
            FROM query_logs
            WHERE incident_id = $1
            ORDER BY created_at ASC
            """,
            incident_id,
        )
    return {
        "incident_id": incident_id,
        "count": len(rows),
        "traces": [dict(r) | {"id": str(r["id"])} for r in rows],
    }


# ----------------------------------------------------------- connector specs
@router.get("/source-types", tags=["sources"])
async def source_types(_: ApiKeyContext = Depends(get_api_key)) -> dict:
    """Field schema for every connector, so a UI can build its own forms.

    Without this the setup screen would hardcode one form per connector, and
    adding a connector would mean editing the backend and the frontend in step.
    """
    return {
        "vault_enabled": vault_enabled(),
        "types": [spec.to_dict() for _, spec in sorted(SOURCE_SPECS.items())],
    }


@router.post("/sources/test", response_model=SourceTestOut, tags=["sources"])
async def test_source(
    payload: SourceTestIn, _: ApiKeyContext = Depends(require_scope("write"))
) -> SourceTestOut:
    """Validate a config against the real vendor before saving it.

    Deliberately runs on the unsaved payload. The alternative — save, wait for
    the interval, read last_error — is an hour-long feedback loop on a mistake
    that takes two seconds to make.
    """
    vault = await load_vault()
    result = await run_check(payload.type, payload.config or {}, vault)
    return SourceTestOut(ok=result.ok, message=result.message, detail=result.detail)


# ----------------------------------------------------------------- secrets
@router.post(
    "/secrets", response_model=SecretOut, status_code=status.HTTP_201_CREATED, tags=["secrets"]
)
async def create_secret(
    payload: SecretIn, _: ApiKeyContext = Depends(require_scope("admin"))
) -> SecretOut:
    """Store a connector credential, encrypted.

    Requires the admin scope: a write-scoped agent can register sources, but
    handing out vendor credentials is a separate privilege.
    """
    try:
        stored = await put_secret(payload.name, payload.value, payload.description)
    except VaultError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return SecretOut(**stored, used_by=[])


@router.get("/secrets", response_model=list[SecretOut], tags=["secrets"])
async def get_secrets(_: ApiKeyContext = Depends(require_scope("admin"))) -> list[SecretOut]:
    """Metadata only — there is no endpoint that returns a stored secret."""
    return [SecretOut(**row) for row in await list_secrets()]


@router.delete("/secrets/{name}", tags=["secrets"])
async def remove_secret(
    name: str, _: ApiKeyContext = Depends(require_scope("admin"))
) -> dict:
    if not await delete_secret(name):
        raise HTTPException(status_code=404, detail="secret not found")
    return {"deleted": name}


# ----------------------------------------------------------------- prompts
@router.get("/prompts", tags=["prompts"])
async def get_prompts(_: ApiKeyContext = Depends(get_api_key)) -> dict:
    return {
        "definitions": [d.to_dict() for d in prompt_store.PROMPT_DEFS],
        "prompts": await prompt_store.list_prompts(),
    }


@router.get("/prompts/{key}/versions", tags=["prompts"])
async def get_prompt_versions(
    key: str,
    collection: str | None = Query(default=None),
    _: ApiKeyContext = Depends(get_api_key),
) -> dict:
    return {"key": key, "collection": collection,
            "versions": await prompt_store.history(key, collection)}


@router.put("/prompts/{key}", tags=["prompts"])
async def save_prompt(
    key: str, payload: PromptSaveIn, _: ApiKeyContext = Depends(require_scope("admin"))
) -> dict:
    """Save a new version and activate it.

    Validation is strict on purpose. A template saved without ``{context}``
    still renders — the model just receives no passages and answers from its own
    knowledge, while citation checks and the groundedness judge keep reporting
    success against a context that was never sent. That has to fail here.
    """
    try:
        return await prompt_store.save_version(
            key,
            payload.body,
            collection=payload.collection,
            note=payload.note,
            created_by=payload.created_by,
        )
    except prompt_store.PromptValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/prompts/versions/{version_id}/activate", tags=["prompts"])
async def activate_prompt_version(
    version_id: str, _: ApiKeyContext = Depends(require_scope("admin"))
) -> dict:
    try:
        return await prompt_store.activate_version(version_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/prompts/{key}/reset", tags=["prompts"])
async def reset_prompt(
    key: str,
    collection: str | None = Query(default=None),
    _: ApiKeyContext = Depends(require_scope("admin")),
) -> dict:
    """Restore the shipped default as a new version, keeping the history."""
    if key not in prompt_store.PROMPTS_BY_KEY:
        raise HTTPException(status_code=404, detail=f"unknown prompt key '{key}'")
    return await prompt_store.reset_to_default(key, collection)


# ----------------------------------------------------------------- sources
@router.post(
    "/sources", response_model=SourceOut, status_code=status.HTTP_201_CREATED, tags=["sources"]
)
async def create_source(
    payload: SourceIn, _: ApiKeyContext = Depends(require_scope("write"))
) -> SourceOut:
    pool = await get_pool()
    async with pool.acquire() as conn:
        collection_id = await conn.fetchval(
            "SELECT id FROM collections WHERE name = $1", payload.collection
        )
        if collection_id is None:
            raise HTTPException(
                status_code=404, detail=f"collection '{payload.collection}' does not exist"
            )
        row = await conn.fetchrow(
            """
            INSERT INTO sources (collection_id, name, type, config, interval_seconds, enabled)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6)
            ON CONFLICT (collection_id, name) DO UPDATE SET
                type = EXCLUDED.type,
                config = EXCLUDED.config,
                interval_seconds = EXCLUDED.interval_seconds,
                enabled = EXCLUDED.enabled
            RETURNING *
            """,
            collection_id,
            payload.name,
            payload.type,
            payload.config,
            payload.interval_seconds,
            payload.enabled,
        )
    return _source_out(row, payload.collection, await load_vault())


def _source_out(row, collection: str, vault) -> SourceOut:
    """Shared projection. `config` is redacted before it leaves the process."""
    next_run = None
    if row["enabled"] and row["last_run_at"] is not None:
        next_run = row["last_run_at"] + timedelta(seconds=row["interval_seconds"])
    return SourceOut(
        id=str(row["id"]),
        collection=collection,
        name=row["name"],
        type=row["type"],
        interval_seconds=row["interval_seconds"],
        enabled=row["enabled"],
        last_run_at=row["last_run_at"],
        last_status=row["last_status"],
        last_error=row["last_error"],
        config=redact(row["config"] or {}, vault),
        next_run_at=next_run,
    )


@router.get("/sources", response_model=list[SourceOut], tags=["sources"])
async def list_sources(_: ApiKeyContext = Depends(get_api_key)) -> list[SourceOut]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.*, c.name AS collection
            FROM sources s JOIN collections c ON c.id = s.collection_id
            ORDER BY s.name
            """
        )
    vault = await load_vault()
    return [_source_out(r, r["collection"], vault) for r in rows]


@router.put("/sources/{source_id}", response_model=SourceOut, tags=["sources"])
async def update_source(
    source_id: str,
    payload: SourceUpdate,
    _: ApiKeyContext = Depends(require_scope("write")),
) -> SourceOut:
    """Edit a source in place.

    `POST /sources` upserts on `(collection, name)`, so it cannot rename: a new
    name is a new source, and the old one keeps polling beside it. Editing by id
    is the only way to say "this source, with a different name".

    The cursor is deliberately preserved. Changing an interval or a filter is
    not a reason to re-fetch history — and for a connector like `slack` that
    would mean re-reading ninety days of threads.
    """
    fields = payload.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=422, detail="no fields to update")

    pool = await get_pool()
    async with pool.acquire() as conn:
        if "collection" in fields:
            collection_id = await conn.fetchval(
                "SELECT id FROM collections WHERE name = $1", fields.pop("collection")
            )
            if collection_id is None:
                raise HTTPException(
                    status_code=404, detail=f"collection '{payload.collection}' does not exist"
                )
            fields["collection_id"] = collection_id

        # Built positionally rather than by string interpolation of values: the
        # keys come from the schema, never from the request body.
        assignments = ", ".join(
            f"{column} = ${i}"
            + ("::jsonb" if column == "config" else "")
            for i, column in enumerate(fields, start=2)
        )
        try:
            row = await conn.fetchrow(
                f"""
                UPDATE sources SET {assignments} WHERE id = $1
                RETURNING *, (SELECT name FROM collections c WHERE c.id = sources.collection_id)
                          AS collection
                """,
                source_id,
                *fields.values(),
            )
        except asyncpg.UniqueViolationError as exc:
            raise HTTPException(
                status_code=409,
                detail="a source with that name already exists in this collection",
            ) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="source not found")
    return _source_out(row, row["collection"], await load_vault())


@router.get(
    "/sources/{source_id}/runs", response_model=list[SourceRunOut], tags=["sources"]
)
async def source_runs(
    source_id: str,
    limit: int = Query(default=20, ge=1, le=200),
    _: ApiKeyContext = Depends(get_api_key),
) -> list[SourceRunOut]:
    """Poll history for one source.

    `sources.last_status` only shows the most recent attempt, so a connector
    that fails one poll in ten looks perfectly healthy nine times out of ten.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM source_runs
            WHERE source_id = $1 ORDER BY started_at DESC LIMIT $2
            """,
            source_id,
            limit,
        )
    return [SourceRunOut(**dict(r) | {"id": str(r["id"])}) for r in rows]


@router.post("/sources/{source_id}/sync", tags=["sources"])
async def sync_source_now(
    source_id: str, _: ApiKeyContext = Depends(require_scope("write"))
) -> dict:
    """Trigger a poll immediately instead of waiting for the interval."""
    job_id = await enqueue("sync_source_task", source_id, "manual")
    if job_id is None:
        raise HTTPException(status_code=503, detail="worker queue unavailable")
    return {"job_id": job_id, "source_id": source_id}


@router.delete("/sources/{source_id}", tags=["sources"])
async def delete_source(
    source_id: str, _: ApiKeyContext = Depends(require_scope("write"))
) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        deleted = await conn.fetchval(
            "DELETE FROM sources WHERE id = $1 RETURNING id", source_id
        )
    if deleted is None:
        raise HTTPException(status_code=404, detail="source not found")
    return {"deleted": source_id}


# ---------------------------------------------------------------- api keys
@router.post(
    "/admin/api-keys", response_model=ApiKeyOut, status_code=status.HTTP_201_CREATED, tags=["admin"]
)
async def issue_api_key(
    payload: ApiKeyIn, _: ApiKeyContext = Depends(require_scope("admin"))
) -> ApiKeyOut:
    raw, key_id = await create_api_key(
        payload.name, payload.scopes, payload.rate_limit_per_minute
    )
    return ApiKeyOut(id=key_id, name=payload.name, api_key=raw, scopes=payload.scopes)


@router.get("/admin/stats", tags=["admin"])
async def stats(
    days: int = Query(default=7, ge=1, le=90),
    _: ApiKeyContext = Depends(require_scope("admin")),
) -> dict:
    """Corpus size and answer-quality counters — the demo dashboard numbers."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        corpus = await conn.fetchrow(
            """
            SELECT (SELECT count(*) FROM collections) AS collections,
                   (SELECT count(*) FROM documents WHERE deleted_at IS NULL) AS documents,
                   (SELECT count(*) FROM chunks) AS chunks
            """
        )
        quality = await conn.fetchrow(
            """
            SELECT count(*) AS queries,
                   count(*) FILTER (WHERE abstained) AS abstentions,
                   avg(latency_ms)::int AS avg_latency_ms,
                   avg((groundedness->>'score')::float)
                       FILTER (WHERE groundedness->>'score' IS NOT NULL) AS avg_groundedness
            FROM query_logs
            WHERE created_at > now() - make_interval(days => $1)
            """,
            days,
        )
        feedback = await conn.fetchrow(
            """
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE rating > 0) AS positive,
                   count(*) FILTER (WHERE rating < 0) AS negative
            FROM feedback
            WHERE created_at > now() - make_interval(days => $1)
            """,
            days,
        )
    return {
        "window_days": days,
        "corpus": dict(corpus),
        "quality": dict(quality),
        "feedback": dict(feedback),
    }
