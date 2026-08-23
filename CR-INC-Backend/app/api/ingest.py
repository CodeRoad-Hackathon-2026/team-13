"""Where incidents come in.

Not part of the dashboard's contract — the UI reads incidents, it does not create
them. This is the edge the alerting systems post to, and the entry point for the
agent pipeline.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Body, Depends
from pydantic import BaseModel, Field

import asyncpg
from app.agents.intake import ingest_incident
from app.agents.pipeline import triage_incident
from app.api.deps import connection
from app.rag_client import get_rag_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ingest"])


class IncidentPayload(BaseModel):
    # Everything is optional except a way to say what happened: intake derives a
    # title from the subject or the first sentence of the body, and defaults the
    # rest rather than rejecting an alert for being untidy.
    title: str | None = None
    subject: str | None = None
    summary: str | None = None
    description: str | None = None
    body: str | None = None
    source: str | None = None
    external_id: str | None = Field(default=None, max_length=255)
    environment: str | None = None


@router.post("/incidents/ingest", status_code=202)
async def ingest(
    background: BackgroundTasks,
    payload: IncidentPayload = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    """Create the incident, then triage it in the background.

    Returns as soon as the incident exists. Triage calls an LLM twice and can
    take tens of seconds; an alerting system posting a webhook should not be
    held open for it, and would retry on the timeout — creating a second
    incident for the same alert.
    """
    incident, created = await ingest_incident(conn, payload.model_dump())
    incident_id = str(incident["id"])

    if created:
        background.add_task(_triage, incident_id)
    else:
        logger.info("ingest: %s already existed, not re-triaging", incident_id)

    return {"incidentId": incident_id, "created": created, "status": "triaging" if created else "existing"}


async def _triage(incident_id: str) -> None:
    try:
        await triage_incident(incident_id, get_rag_client())
    except Exception:  # noqa: BLE001 — a background task that dies silently is worse
        logger.exception("triage failed for %s", incident_id)
