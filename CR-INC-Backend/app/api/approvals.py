"""Approval queue and the approve/reject lifecycle."""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from app.agents.execution import execute_in_background
from app.agents.patch import parse_unified_diff
from app.agents.rag_feedback import report_rejection
from app.db import get_pool
from app.agents.preflight import preflight
from app.api.deps import connection, not_found
from app.config import settings
from app.queries import approvals as q
from app.rag_client import get_rag_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["approvals"])

TOP_MATCH_CAP = 3


class ApproveRequest(BaseModel):
    actor: str = Field(min_length=1)
    confirmedHighRisk: bool | None = None


class RejectRequest(BaseModel):
    actor: str = Field(min_length=1)
    reason: str = ""
    correctedCategory: str | None = None
    correctedPriority: str | None = None


@router.get("/approvals/pending")
async def pending(conn: asyncpg.Connection = Depends(connection)) -> dict[str, Any]:
    rows = await conn.fetch(q.PENDING)

    matches_by_incident: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if rows:
        incident_ids = list({str(row["incident_id"]) for row in rows})
        for match in await conn.fetch(q.TOP_MATCHES, incident_ids):
            bucket = matches_by_incident[str(match["incident_id"])]
            if len(bucket) < TOP_MATCH_CAP:
                bucket.append(
                    {
                        "documentType": match["document_type"],
                        "title": match["title"],
                        "score": float(match["score"]),
                        "sourceUrl": match["source_url"],
                    }
                )

    auto_executed = await conn.fetchval(q.AUTO_EXECUTED_IN_RANGE)

    return {
        "cards": [
            {
                "id": str(row["id"]),
                "incidentId": str(row["incident_id"]),
                "incidentExternalId": row["incident_external_id"] or "",
                "priority": row["priority"],
                "serviceName": row["service_name"],
                "environment": row["environment"],
                "incidentTitle": row["incident_title"],
                "actionType": row["action_type"],
                "description": row["description"],
                "riskLevel": row["risk_level"],
                "confidenceScore": float(row["confidence_score"]),
                "topMatches": matches_by_incident.get(str(row["incident_id"]), []),
                "proposedAt": row["proposed_at"].isoformat(),
                "proposedByAgent": row["proposed_by_agent"],
            }
            for row in rows
        ],
        # No `parameters` anywhere above — P-4 keeps JSONB out of list responses.
        "autoExecutedCountInRange": auto_executed or 0,
    }


@router.post("/actions/{action_id}/approve", status_code=202)
async def approve(
    action_id: str,
    background: BackgroundTasks,
    payload: ApproveRequest = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    # X-4: the whole point of this endpoint is that it cannot fire a remediation
    # twice. The row is locked for the duration so a second request either waits
    # and then sees APPROVED, or is this one.
    async with conn.transaction():
        action = await conn.fetchrow(q.LOCK_ACTION, action_id)
        if action is None:
            raise not_found("That action no longer exists.")
        if action["status"] != "PROPOSED":
            raise HTTPException(status_code=409, detail="Action is no longer pending approval")
        if action["risk_level"] == "HIGH" and payload.confirmedHighRisk is not True:
            raise HTTPException(
                status_code=400, detail="High-risk actions require explicit confirmation."
            )

        await conn.execute(q.APPROVE, action_id, payload.actor)
        execution_id = await conn.fetchval(q.START_EXECUTION, action_id, payload.actor)
        await _record_event(
            conn,
            str(action["incident_id"]),
            "ACTION_APPROVED",
            f"Approved by {payload.actor}.",
            {"recommended_action_id": action_id, "executed_action_id": str(execution_id)},
            payload.actor,
        )

    # Runs after the response. The card polls the execution row and needs to see
    # RUNNING first; holding the request open until the tool finishes would also
    # make Approve time out on anything slow.
    background.add_task(execute_in_background, str(execution_id))

    return {"executedActionId": str(execution_id), "status": "RUNNING"}


@router.post("/actions/{action_id}/reject")
async def reject(
    action_id: str,
    payload: RejectRequest = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    reason = payload.reason.strip()
    if not reason:
        # AR-6: a rejection without a reason teaches the system nothing. Guarded
        # here as well as in the form, so a client bug cannot bypass it.
        raise HTTPException(status_code=400, detail="A rejection reason is required.")

    async with conn.transaction():
        action = await conn.fetchrow(q.LOCK_ACTION, action_id)
        if action is None:
            raise not_found("That action no longer exists.")
        if action["status"] != "PROPOSED":
            raise HTTPException(status_code=409, detail="Action is no longer pending approval")

        updated = await conn.fetchrow(q.REJECT, action_id, payload.actor)
        await conn.execute(
            q.REJECTION_FEEDBACK,
            str(action["incident_id"]),
            action["agent_run_id"],
            action_id,
            reason,
            payload.correctedCategory,
            payload.correctedPriority,
            payload.actor,
        )
        await _record_event(
            conn,
            str(action["incident_id"]),
            "ACTION_REJECTED",
            f"Rejected by {payload.actor} — {reason}",
            {"recommended_action_id": action_id},
            payload.actor,
        )

    # After the commit, and best-effort: the rejection is already durable, and
    # the operator's action must not fail because the RAG is unreachable.
    reported = await report_rejection(conn, action_id, reason, get_rag_client())
    if not reported:
        logger.info("rejection of %s was not reported to RAG Core", action_id)

    return {
        "status": "REJECTED",
        "approvedBy": updated["approved_by"],
        "approvedAt": updated["approved_at"].isoformat(),
    }


@router.get("/actions/{action_id}/execution")
async def execution_status(
    action_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    row = await conn.fetchrow(q.EXECUTION_STATUS, action_id)
    if row is None:
        raise not_found("No execution found for this action")
    return {
        "status": row["status"],
        "errorMessage": row["error_message"],
        "startedAt": row["started_at"].isoformat(),
        "finishedAt": row["finished_at"].isoformat() if row["finished_at"] else None,
        # No execution_logs or response_payload here (P-4) — those need
        # GET /api/executions/:id/detail and a deliberate expand.
    }


@router.get("/actions/{action_id}/parameters")
async def action_parameters(
    action_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    row = await conn.fetchrow(q.ACTION_PARAMETERS, action_id)
    if row is None:
        raise not_found("That action no longer exists.")
    parameters = json.loads(row["parameters"]) if row["parameters"] else {}

    # A proposed code change is stored as a unified diff. The Decision Agent
    # parses it when it proposes, but an action written by anything else — a
    # seed, an operator, another system — only has the raw diff, and the viewer
    # should render that too.
    if "proposedChange" not in parameters and isinstance(parameters.get("diff"), str):
        parsed = parse_unified_diff(parameters["diff"])
        if parsed["files"]:
            parameters["proposedChange"] = {
                "repo": parameters.get("repo"),
                "branch": parameters.get("branch"),
                "base": parameters.get("base") or "main",
                "summary": parameters.get("summary"),
                **parsed,
            }

    # Otherwise raw passthrough: for SQL actions the client formats
    # `parameters.statement` itself and must not be handed a pre-formatted string.
    return {"parameters": parameters}


@router.get("/actions/{action_id}/preflight")
async def action_preflight(
    action_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    """What the execution path would decide, asked before the approval instead of after.

    Read-only and offline: it calls the same guard functions the executors call,
    and none of them touch the network. Lazily fetched like the parameters panel
    (P-4) — the dashboard asks only when an operator opens the panel.
    """
    row = await conn.fetchrow(q.ACTION_PREFLIGHT, action_id)
    if row is None:
        raise not_found("That action no longer exists.")

    parameters = json.loads(row["parameters"]) if row["parameters"] else {}
    return preflight(
        action_type=row["action_type"],
        parameters=parameters,
        status=row["status"],
        approved_by=row["approved_by"],
        repository_url=row["repository_url"],
    )


async def _record_event(
    conn: asyncpg.Connection,
    incident_id: str,
    event_type: str,
    description: str,
    payload: dict[str, Any],
    created_by: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO incident_events (incident_id, event_type, description, payload, created_by)
        VALUES ($1, $2, $3, $4::jsonb, $5)
        """,
        incident_id,
        event_type,
        description,
        json.dumps(payload),
        created_by,
    )
