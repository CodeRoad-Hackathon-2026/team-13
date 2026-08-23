"""The incident list, the detail drawer, and its lazily-loaded panels."""

from __future__ import annotations

import json
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import connection, not_found, parse_service
from app.queries import incidents as q

router = APIRouter(tags=["incidents"])

PAGE_SIZE = 25
SIMILARITY_CAP = 5

# Precomputed server-side so the client never re-derives the event taxonomy.
FAILURE_EVENTS = {"VALIDATION_FAILED", "ACTION_REJECTED", "ESCALATED"}

KPI_PREDICATES = {
    "openIncidents": "i.status NOT IN ('RESOLVED','CLOSED')",
    "escalated": "i.status = 'ESCALATED'",
    "unassigned": "i.assigned_to IS NULL AND i.status NOT IN ('RESOLVED','CLOSED')",
    "knownHitRate": "i.is_known_incident",
    "medianResolve": "i.status IN ('RESOLVED','CLOSED')",
}

# Which incidents fell out *into* each funnel stage — the rows the stage's
# dropCount counted. Each is "reached the stage above but not this one".
FUNNEL_DROP_SETS = {
    "classified": "i.category IS NULL",
    "ragMatched": "i.category IS NOT NULL AND NOT i.is_known_incident",
    "recommended": (
        "i.is_known_incident AND NOT EXISTS "
        "(SELECT 1 FROM recommended_actions ra WHERE ra.incident_id = i.id)"
    ),
    "approvedOrAutoRun": (
        "EXISTS (SELECT 1 FROM recommended_actions ra WHERE ra.incident_id = i.id) "
        "AND NOT EXISTS (SELECT 1 FROM recommended_actions ra WHERE ra.incident_id = i.id "
        "AND (ra.status IN ('APPROVED','EXECUTED') OR ra.approval_required = FALSE))"
    ),
    "executedSuccessfully": (
        "EXISTS (SELECT 1 FROM recommended_actions ra WHERE ra.incident_id = i.id "
        "AND (ra.status IN ('APPROVED','EXECUTED') OR ra.approval_required = FALSE)) "
        "AND NOT EXISTS (SELECT 1 FROM recommended_actions ra "
        "JOIN executed_actions e ON e.recommended_action_id = ra.id "
        "WHERE ra.incident_id = i.id AND e.status = 'SUCCESS')"
    ),
}

# K4: resolved-or-repeat incidents with no RAG match — the learning backlog.
CANDIDATE_PREDICATE = "NOT i.is_known_incident"


def _automation_status(row: asyncpg.Record) -> str:
    if not row["action_count"]:
        return "none"
    if row["proposed_count"]:
        return "needs_human"
    if row["auto_success_count"]:
        return "fully_automated"
    if row["approved_success_count"]:
        return "human_approved"
    return "needs_human"


def _candidate_reason(row: asyncpg.Record) -> str:
    if row["resolved_at"] is not None:
        return "resolved manually · no RAG match found"
    return "no RAG match found"


@router.get("/incidents")
async def list_incidents(
    env: str | None = Query(default=None),
    service: str | None = Depends(parse_service),
    q_text: str | None = Query(default=None, alias="q"),
    page: int = Query(default=1, ge=1),
    sort: str = Query(default="priority"),
    includeResolved: bool = Query(default=False),
    kpiTile: str | None = Query(default=None),
    funnelDropAt: str | None = Query(default=None),
    funnelStage: str | None = Query(default=None),
    breakdown: str | None = Query(default=None),
    candidate: bool = Query(default=False),
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    where: list[str] = []
    params: list[Any] = []

    def add(clause: str, value: Any = None) -> None:
        if value is None:
            where.append(clause)
            return
        params.append(value)
        where.append(clause.format(n=len(params)))

    # The base row-set is chosen first, and some drill-downs REPLACE the default
    # open-only scope rather than narrowing it — otherwise a funnel stage that
    # counted resolved incidents would drill into an empty table.
    shows_resolved = includeResolved or candidate
    if funnelDropAt and funnelDropAt in FUNNEL_DROP_SETS:
        add(FUNNEL_DROP_SETS[funnelDropAt])
        shows_resolved = True
    elif funnelStage == "received" or kpiTile == "medianResolve":
        shows_resolved = True

    if candidate:
        add(CANDIDATE_PREDICATE)

    if kpiTile and kpiTile in KPI_PREDICATES:
        add(KPI_PREDICATES[kpiTile])
    elif kpiTile == "oldestOpen":
        # A single row by definition: the tile shows one incident's age.
        add("i.status NOT IN ('RESOLVED','CLOSED')")
    elif kpiTile == "automationRate":
        add(
            "EXISTS (SELECT 1 FROM recommended_actions ra JOIN executed_actions e "
            "ON e.recommended_action_id = ra.id WHERE ra.incident_id = i.id "
            "AND ra.approval_required = FALSE AND e.status = 'SUCCESS')"
        )
        shows_resolved = True

    if breakdown and ":" in breakdown:
        kind, _, value = breakdown.partition(":")
        column = {"priority": "i.priority::text", "category": "i.category", "service": "i.service_id::text"}.get(kind)
        if column:
            add(f"{column} = ${{n}}", value)
        shows_resolved = True

    if not shows_resolved:
        add("i.status NOT IN ('RESOLVED','CLOSED')")

    if env:
        add("i.environment = ANY(${n}::text[])", [e.strip() for e in env.split(",") if e.strip()])
    if service:
        add("i.service_id = ${n}::uuid", service)
    if status:
        add("i.status::text = ${n}", status)
    if priority:
        add("i.priority::text = ${n}", priority)
    if q_text:
        # All three placeholders resolve to the same parameter — one bind, three
        # columns, matching FR-051's "title OR description OR external id".
        add(
            "(i.title ILIKE '%' || ${n} || '%' OR i.description ILIKE '%' || ${n} || '%' "
            "OR i.external_id ILIKE '%' || ${n} || '%')",
            q_text,
        )

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = await conn.fetchval(f"SELECT COUNT(*) FROM incidents i{clause}", *params)

    order = q.ORDER_BY.get(sort, q.ORDER_BY["priority"])
    limit = 1 if kpiTile == "oldestOpen" else PAGE_SIZE
    if kpiTile == "oldestOpen":
        order = "i.created_at ASC"

    rows = await conn.fetch(
        f"{q.LIST_SELECT}{clause} ORDER BY {order} LIMIT {limit} OFFSET {(page - 1) * PAGE_SIZE}",
        *params,
    )

    return {
        "rows": [
            {
                "id": str(r["id"]),
                "externalId": r["external_id"] or "",
                "priority": r["priority"],
                "status": r["status"],
                "title": r["title"],
                "serviceName": r["service_name"],
                "environment": r["environment"],
                "category": r["category"],
                "isKnownIncident": r["is_known_incident"],
                "bestMatchScore": float(r["best_match_score"]) if r["best_match_score"] is not None else None,
                "confidenceScore": float(r["confidence_score"]) if r["confidence_score"] is not None else None,
                "createdAt": r["created_at"].isoformat(),
                "assignedTo": r["assigned_to"],
                "automationStatus": _automation_status(r),
                "source": r["source"],
                # Only populated for the candidate view — the column is otherwise
                # meaningless and the UI reads its presence as "this is a candidate".
                "candidateReason": _candidate_reason(r) if candidate else None,
                "recurrenceCount": None,
            }
            for r in rows
        ],
        # Post-filter, pre-page: it must reconcile with the number on the tile
        # the operator clicked (SC-005).
        "totalCount": total,
        "page": page,
    }


@router.get("/incidents/{incident_id}")
async def incident_detail(
    incident_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    incident = await conn.fetchrow(q.DETAIL, incident_id)
    if incident is None:
        raise not_found("That incident could not be found.")

    correction = await conn.fetchrow(q.CORRECTION, incident_id)
    runs = await conn.fetch(q.AGENT_RUNS, incident_id)
    matches = await conn.fetch(q.SIMILARITY_MATCHES, incident_id)
    actions = await conn.fetch(q.ACTIONS, incident_id)
    events = await conn.fetch(q.EVENTS, incident_id, False)
    feedback = await conn.fetch(q.FEEDBACK, incident_id)

    return {
        "incident": {
            "id": str(incident["id"]),
            "externalId": incident["external_id"] or "",
            "title": incident["title"],
            "status": incident["status"],
            "priority": incident["priority"],
            "serviceName": incident["service_name"],
            "environment": incident["environment"],
            "assignedTo": incident["assigned_to"],
            "createdAt": incident["created_at"].isoformat(),
            "resolvedAt": incident["resolved_at"].isoformat() if incident["resolved_at"] else None,
            "source": incident["source"],
        },
        "aiClassification": {
            "category": incident["category"],
            "priority": incident["priority"],
            "confidenceScore": (
                float(incident["confidence_score"]) if incident["confidence_score"] is not None else None
            ),
        },
        "correction": (
            {
                "correctedCategory": correction["corrected_category"],
                "correctedPriority": correction["corrected_priority"],
            }
            if correction
            else None
        ),
        "agentRuns": [_agent_run(r) for r in runs],
        # Capped: the uncapped set is a separate, deliberate request.
        "similarityMatches": [_match(m) for m in matches[:SIMILARITY_CAP]],
        "actions": [_action(a) for a in actions],
        "events": [_event(e) for e in events],
        "feedback": [_feedback(f) for f in feedback],
    }


@router.get("/incidents/{incident_id}/similarity-matches")
async def all_similarity_matches(
    incident_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    rows = await conn.fetch(q.SIMILARITY_MATCHES, incident_id)
    return {"matches": [_match(m) for m in rows]}


@router.get("/incidents/{incident_id}/events")
async def incident_events(
    incident_id: str,
    agentOnly: bool = Query(default=False),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    rows = await conn.fetch(q.EVENTS, incident_id, agentOnly)
    return {"events": [_event(e) for e in rows]}


@router.get("/incidents/{incident_id}/agent-runs/{run_id}/io")
async def agent_run_io(
    incident_id: str, run_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    row = await conn.fetchrow(q.AGENT_RUN_IO, run_id, incident_id)
    if row is None:
        raise not_found("That agent run could not be found.")
    return {
        "input": json.loads(row["input"]) if row["input"] else None,
        "output": json.loads(row["output"]) if row["output"] else None,
    }


@router.get("/executions/{execution_id}/detail")
async def execution_detail(
    execution_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    row = await conn.fetchrow(q.EXECUTION_DETAIL, execution_id)
    if row is None:
        raise not_found("That execution could not be found.")
    return {
        "responsePayload": json.loads(row["response_payload"]) if row["response_payload"] else None,
        "executionLogs": row["execution_logs"],
    }


def _agent_run(r: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(r["id"]),
        "agentName": r["agent_name"],
        "agentVersion": r["agent_version"],
        "status": r["status"],
        "startedAt": r["started_at"].isoformat(),
        "finishedAt": r["finished_at"].isoformat() if r["finished_at"] else None,
        "latencyMs": r["latency_ms"],
        "confidenceScore": float(r["confidence_score"]) if r["confidence_score"] is not None else None,
        # The message itself needs the lazy io endpoint — only the flag travels here.
        "hasError": r["status"] == "FAILED",
    }


def _match(m: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(m["id"]),
        "documentType": m["document_type"],
        "title": m["title"],
        "score": float(m["score"]),
        "summarySnippet": m["summary_snippet"],
        "sourceUrl": m["source_url"],
    }


def _action(a: asyncpg.Record) -> dict[str, Any]:
    # EXECUTED exists in the database enum but not in the frontend's union. The
    # execution is what carries that fact, so the recommendation reports the
    # decision a human made and nothing more.
    status = "APPROVED" if a["status"] == "EXECUTED" else a["status"]
    return {
        "id": str(a["id"]),
        "actionType": a["action_type"],
        "description": a["description"],
        "riskLevel": a["risk_level"],
        "confidenceScore": float(a["confidence_score"]),
        "status": status,
        "approvedBy": a["approved_by"],
        "approvedAt": a["approved_at"].isoformat() if a["approved_at"] else None,
        "execution": (
            {
                "id": str(a["execution_id"]),
                "status": a["execution_status"],
                "startedAt": a["execution_started_at"].isoformat(),
                "finishedAt": (
                    a["execution_finished_at"].isoformat() if a["execution_finished_at"] else None
                ),
                "errorMessage": a["execution_error"],
            }
            if a["execution_id"]
            else None
        ),
    }


def _event(e: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(e["id"]),
        "eventType": e["event_type"],
        "description": e["description"],
        "createdBy": e["created_by"],
        "createdAt": e["created_at"].isoformat(),
        "isAgentEvent": "Agent" in e["created_by"],
        "isFailureEvent": e["event_type"] in FAILURE_EVENTS,
    }


def _feedback(f: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(f["id"]),
        "feedbackType": f["feedback_type"],
        "comments": f["comments"],
        "correctedCategory": f["corrected_category"],
        "correctedPriority": f["corrected_priority"],
        "correctedResolution": f["corrected_resolution"],
        "createdBy": f["created_by"],
        "createdAt": f["created_at"].isoformat(),
    }
