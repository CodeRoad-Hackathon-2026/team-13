"""Writer for `incident_events` — the timeline the dashboard's drawer renders.

The event_type values are the vocabulary the frontend already knows how to
draw (see its EVENT_ICON map); emitting anything else renders as an unlabelled
row, so they are constants here rather than free strings at each call site.
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg

INCIDENT_CREATED = "INCIDENT_CREATED"
INCIDENT_CLASSIFIED = "INCIDENT_CLASSIFIED"
RAG_SEARCH_STARTED = "RAG_SEARCH_STARTED"
RAG_SEARCH_COMPLETED = "RAG_SEARCH_COMPLETED"
SIMILAR_INCIDENT_FOUND = "SIMILAR_INCIDENT_FOUND"
ACTION_RECOMMENDED = "ACTION_RECOMMENDED"
# A proposal a policy withheld. Distinct from an agent that found nothing: the
# frontend has no icon for it yet and will draw it as an unlabelled row, which is
# still better than the alternative — silence that reads as "nothing to do".
ACTION_SUPPRESSED = "ACTION_SUPPRESSED"
ACTION_EXECUTED = "ACTION_EXECUTED"
VALIDATION_FAILED = "VALIDATION_FAILED"


async def record_event(
    conn: asyncpg.Connection,
    incident_id: str,
    event_type: str,
    description: str,
    *,
    payload: dict[str, Any] | None = None,
    created_by: str = "orchestrator",
) -> None:
    await conn.execute(
        """
        INSERT INTO incident_events (incident_id, event_type, description, payload, created_by)
        VALUES ($1, $2, $3, $4::jsonb, $5)
        """,
        incident_id,
        event_type,
        description,
        json.dumps(payload or {}),
        created_by,
    )
