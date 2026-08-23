"""Incident Intake Agent — turns an inbound payload into an incident row.

The one agent whose run cannot precede its own incident: agent_runs.incident_id
is a NOT NULL foreign key, so there is nothing to attribute a run to until the
incident exists. Intake therefore creates the row first and then records the run
that parsed it, inside one transaction — either both land or neither does.
"""

from __future__ import annotations

import logging
import re
from typing import Any, ClassVar

import asyncpg

from app.agents import events
from app.agents.base import Agent, AgentResult

logger = logging.getLogger(__name__)

# Free VARCHAR in the schema, but the dashboard's filter chips are a closed set.
# A value outside it renders as a chip nobody can select.
SOURCES = {"email": "Email", "slack": "Slack", "pagerduty": "PagerDuty", "api": "API", "manual": "Manual"}
ENVIRONMENTS = {"production": "Production", "prod": "Production", "staging": "Staging", "development": "Development", "dev": "Development"}

# Enough of a title to be scannable in a table row without truncation mid-word.
TITLE_MAX = 160


def normalise_source(raw: str | None) -> str:
    return SOURCES.get((raw or "").strip().lower(), "Manual")


def normalise_environment(raw: str | None) -> str:
    """Default to Production.

    Deliberately the pessimistic default: an unlabelled incident treated as
    production gets seen, one treated as development gets filtered out of the
    default view and sits unnoticed.
    """
    return ENVIRONMENTS.get((raw or "").strip().lower(), "Production")


def derive_title(payload: dict[str, Any]) -> str:
    """Subject, title, or the first sentence of the body — in that order."""
    for key in ("title", "subject", "summary"):
        value = (payload.get(key) or "").strip()
        if value:
            return value[:TITLE_MAX]

    body = (payload.get("description") or payload.get("body") or "").strip()
    if not body:
        return "Untitled incident"
    first = re.split(r"(?<=[.!?])\s|\n", body, maxsplit=1)[0].strip()
    return (first or body)[:TITLE_MAX]


INSERT_INCIDENT = """
INSERT INTO incidents (external_id, title, description, status, priority, source, environment)
VALUES ($1, $2, $3, 'OPEN', 'P3', $4, $5)
RETURNING id
"""

# Same source + same external id is the same incident, not a second one. A
# retried webhook must not open a duplicate.
FIND_EXISTING = """
SELECT id FROM incidents
WHERE source = $1 AND external_id = $2 AND external_id IS NOT NULL
LIMIT 1
"""

LOAD_INCIDENT = """
SELECT i.id, i.external_id, i.title, i.description, i.status, i.priority,
       i.category, i.source, i.environment, i.is_known_incident,
       s.name AS service_name
FROM incidents i
LEFT JOIN services s ON s.id = i.service_id
WHERE i.id = $1
"""


class IncidentIntakeAgent(Agent):
    name: ClassVar[str] = "Incident Intake Agent"

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def describe_input(self, incident: asyncpg.Record) -> dict[str, Any]:
        return {"payload": self._payload}

    async def handle(
        self, conn: asyncpg.Connection, incident: asyncpg.Record, run_id: str
    ) -> AgentResult:
        # The row already exists by the time this runs — see the module docstring.
        # What the run records is the parse: which fields were found, which were
        # defaulted, and what the incident ended up looking like.
        await events.record_event(
            conn,
            str(incident["id"]),
            events.INCIDENT_CREATED,
            f"Incident received from {incident['source']}"
            + (f" alert `{incident['external_id']}`" if incident["external_id"] else "."),
            payload={"source": incident["source"], "external_id": incident["external_id"]},
            created_by=self.name,
        )
        return AgentResult(
            output={
                "incident_id": str(incident["id"]),
                "title": incident["title"],
                "source": incident["source"],
                "environment": incident["environment"],
                # Named so a reader can tell what the payload actually carried
                # from what intake chose on its behalf.
                "defaulted": [
                    field
                    for field, present in (
                        ("source", bool(self._payload.get("source"))),
                        ("environment", bool(self._payload.get("environment"))),
                        ("external_id", bool(self._payload.get("external_id"))),
                    )
                    if not present
                ],
            }
        )


async def ingest_incident(
    conn: asyncpg.Connection, payload: dict[str, Any]
) -> tuple[asyncpg.Record, bool]:
    """Create the incident and record the run that parsed it.

    Returns the incident and whether it is new — a replayed webhook returns the
    existing row rather than opening a second incident for the same alert.
    """
    source = normalise_source(payload.get("source"))
    external_id = (payload.get("external_id") or "").strip() or None

    if external_id:
        existing = await conn.fetchval(FIND_EXISTING, source, external_id)
        if existing:
            logger.info("intake: %s/%s already ingested", source, external_id)
            return await conn.fetchrow(LOAD_INCIDENT, existing), False

    async with conn.transaction():
        incident_id = await conn.fetchval(
            INSERT_INCIDENT,
            external_id,
            derive_title(payload),
            (payload.get("description") or payload.get("body") or "").strip() or None,
            source,
            normalise_environment(payload.get("environment")),
        )
        incident = await conn.fetchrow(LOAD_INCIDENT, incident_id)
        await IncidentIntakeAgent(payload).execute(conn, incident)

    return await conn.fetchrow(LOAD_INCIDENT, incident_id), True
