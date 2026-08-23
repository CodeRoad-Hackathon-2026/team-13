"""Knowledge Generation Agent — turns a resolved incident into retrievable knowledge.

This is the agent that makes retrieval find anything. A knowledge_documents row
on its own is invisible to search: RAG Core owns the vector store, so the
document has to be pushed there too, keyed by this row's own id.

The write is deliberately two-phase — local row first, ingestion second — and the
ingestion failure is recorded rather than rolled back. A document that exists
locally but is not yet searchable is recoverable by re-running; one that was
rolled back because the RAG was briefly down is simply lost.
"""

from __future__ import annotations

import logging
from typing import Any, ClassVar

import asyncpg

from app.agents.base import Agent, AgentFailed, AgentResult
from app.rag_client import RagClient, RagError

logger = logging.getLogger(__name__)

RESOLVED_INCIDENT = """
SELECT i.id, i.external_id, i.title, i.description, i.status, i.priority,
       i.category, i.source, i.environment, i.is_known_incident,
       i.resolution_summary, i.resolved_at, i.created_at,
       i.service_id, s.name AS service_name
FROM incidents i
LEFT JOIN services s ON s.id = i.service_id
WHERE i.id = $1
"""

EXISTING_DOCUMENT = "SELECT id FROM knowledge_documents WHERE incident_id = $1 LIMIT 1"

INSERT_DOCUMENT = """
INSERT INTO knowledge_documents (
    title, summary, content, document_type, source, source_url, source_id,
    incident_id, service_id
) VALUES ($1, $2, $3, 'INCIDENT', 'orchestrator', $4, $5, $6, $7)
RETURNING id
"""


def build_content(incident: asyncpg.Record) -> str:
    """What a future retrieval should be able to match on.

    Symptom and resolution together: matching on the symptom is how the incident
    is found, and the resolution is why the match is worth anything.
    """
    minutes = None
    if incident["resolved_at"] and incident["created_at"]:
        minutes = round((incident["resolved_at"] - incident["created_at"]).total_seconds() / 60)

    lines = [
        f"# {incident['title']}",
        "",
        f"Service: {incident['service_name'] or 'unknown'}",
        f"Environment: {incident['environment'] or 'unknown'}",
        f"Category: {incident['category'] or 'unclassified'}",
        f"Priority: {incident['priority']}",
    ]
    if minutes is not None:
        lines.append(f"Time to resolution: {minutes} minutes")
    lines += ["", "## Symptom", incident["description"] or "(not recorded)"]
    lines += ["", "## Resolution", incident["resolution_summary"] or "(not recorded)"]
    return "\n".join(lines)


class KnowledgeGenerationAgent(Agent):
    name: ClassVar[str] = "Knowledge Generation Agent"

    def __init__(self, rag: RagClient) -> None:
        self._rag = rag

    def describe_input(self, incident: asyncpg.Record) -> dict[str, Any]:
        return {
            "incident_id": str(incident["id"]),
            "title": incident["title"],
            "resolved_at": incident["resolved_at"].isoformat() if incident["resolved_at"] else None,
        }

    async def handle(
        self, conn: asyncpg.Connection, incident: asyncpg.Record, run_id: str
    ) -> AgentResult:
        incident_id = str(incident["id"])

        if incident["status"] not in ("RESOLVED", "CLOSED"):
            # Not a failure: an open incident simply has no resolution to write
            # down yet, and inventing one would poison the corpus.
            return AgentResult(
                output={"written": False, "reason": f"incident is {incident['status']}, not resolved"}
            )

        if not (incident["resolution_summary"] or "").strip():
            return AgentResult(
                output={"written": False, "reason": "no resolution summary to learn from"}
            )

        existing = await conn.fetchval(EXISTING_DOCUMENT, incident_id)
        if existing:
            return AgentResult(
                output={"written": False, "reason": "already documented",
                        "knowledge_document_id": str(existing)}
            )

        document_id = await conn.fetchval(
            INSERT_DOCUMENT,
            f"{incident['external_id'] or 'INC'} — {incident['title']}",
            incident["resolution_summary"],
            build_content(incident),
            f"/?incident={incident_id}",
            incident["external_id"],
            incident_id,
            incident["service_id"],
        )

        try:
            # external_id is this row's own UUID — the link RagRetrievalAgent
            # resolves hits back through. Anything else makes future matches
            # unlinkable.
            await self._rag.ingest_document(
                external_id=str(document_id),
                title=incident["title"],
                content=build_content(incident),
                source_url=f"/?incident={incident_id}",
                metadata={
                    "service": incident["service_name"],
                    "environment": incident["environment"],
                    "category": incident["category"],
                    "priority": incident["priority"],
                },
            )
        except RagError as exc:
            # The row stays. Re-running the agent will find it via
            # EXISTING_DOCUMENT and skip, so recovery means re-ingesting that id
            # rather than re-writing the document.
            raise AgentFailed(
                f"document {document_id} written locally but not ingested: {exc}"
            ) from exc

        return AgentResult(
            output={
                "written": True,
                "knowledge_document_id": str(document_id),
                "ingested": True,
            },
        )


async def document_incident(
    conn: asyncpg.Connection, incident_id: str, rag: RagClient
) -> AgentResult | None:
    incident = await conn.fetchrow(RESOLVED_INCIDENT, incident_id)
    if incident is None:
        raise LookupError(f"no incident with id {incident_id}")
    return await KnowledgeGenerationAgent(rag).execute(conn, incident)
