"""Classification Agent — assigns category, priority, service and environment.

Grounded in the corpus rather than free-associated: it goes through /v1/answer
so the classification is drawn from how comparable incidents were actually
categorised, and inherits RAG Core's abstention when nothing supports a call.
"""

from __future__ import annotations

import logging
from typing import Any, ClassVar

import asyncpg

from app.agents import events
from app.agents.base import Agent, AgentFailed, AgentResult, to_numeric
from app.agents.parsing import extract_json_object, one_of
from app.rag_client import RagClient, RagError

logger = logging.getLogger(__name__)

PRIORITIES = {"P1", "P2", "P3", "P4"}
ENVIRONMENTS = {"PRODUCTION", "STAGING", "DEVELOPMENT"}

PROMPT = """\
You are the triage classifier for an incident response system.

Incident: {title}
Description: {description}
Reported source: {source}

Using how comparable incidents in the knowledge base were categorised, classify
this one.

Reply with one JSON object and nothing else:
{{"category": "...", "priority": "P1|P2|P3|P4", "service": "...", "environment": "Production|Staging|Development"}}

category is a short noun phrase (Database, API, Deployment, Infrastructure,
Security, ...). service is the name of the affected service if the sources make
it clear, otherwise null. Priority reflects customer impact, not effort.
"""

SERVICE_BY_NAME = "SELECT id FROM services WHERE lower(name) = lower($1) LIMIT 1"

UPDATE_CLASSIFICATION = """
UPDATE incidents
   SET category         = COALESCE($2, category),
       priority         = COALESCE($3::incident_priority, priority),
       service_id       = COALESCE($4::uuid, service_id),
       environment      = COALESCE($5, environment),
       confidence_score = $6
 WHERE id = $1
"""


class ClassificationAgent(Agent):
    name: ClassVar[str] = "Classification Agent"

    def __init__(self, rag: RagClient) -> None:
        self._rag = rag

    def describe_input(self, incident: asyncpg.Record) -> dict[str, Any]:
        return {
            "incident_id": str(incident["id"]),
            "title": incident["title"],
            "source": incident["source"],
        }

    async def handle(
        self, conn: asyncpg.Connection, incident: asyncpg.Record, run_id: str
    ) -> AgentResult:
        incident_id = str(incident["id"])
        prompt = PROMPT.format(
            title=incident["title"],
            description=incident["description"] or "(none supplied)",
            source=incident["source"] or "unknown",
        )

        try:
            response = await self._rag.answer(prompt, incident_id=incident_id)
        except RagError as exc:
            raise AgentFailed(f"classification failed: {exc}") from exc

        confidence = response.get("confidence")

        if response.get("abstained"):
            # Leaving the incident at its intake defaults is the honest outcome:
            # a guessed priority is worse than an unclassified incident, because
            # it looks decided.
            reason = response.get("abstain_reason") or "insufficient grounding"
            return AgentResult(
                output={"classified": False, "reason": reason, "abstained": True},
                confidence=confidence,
                model=response.get("model"),
            )

        parsed = extract_json_object(response.get("answer") or "")
        if parsed is None:
            return AgentResult(
                output={
                    "classified": False,
                    "reason": "the classifier returned prose instead of a classification",
                    "abstained": False,
                },
                confidence=confidence,
                model=response.get("model"),
            )

        category = (str(parsed.get("category") or "").strip() or None)
        priority = one_of(parsed.get("priority"), PRIORITIES, "") or None
        environment = one_of(parsed.get("environment"), ENVIRONMENTS, "").title() or None

        # Only an already-registered service counts. Inventing one from a model's
        # string would put a service on the dashboard that nobody owns.
        service_name = str(parsed.get("service") or "").strip()
        service_id = (
            await conn.fetchval(SERVICE_BY_NAME, service_name) if service_name else None
        )
        if service_name and service_id is None:
            logger.info("classification: unknown service %r on %s", service_name, incident_id)

        await conn.execute(
            UPDATE_CLASSIFICATION,
            incident_id,
            category,
            priority,
            service_id,
            environment,
            to_numeric(confidence, 4),
        )

        await events.record_event(
            conn,
            incident_id,
            events.INCIDENT_CLASSIFIED,
            f"Classified as {category or 'unclassified'} / {priority or incident['priority']}"
            + (f" · confidence {confidence:.2f}" if confidence is not None else ""),
            payload={"category": category, "priority": priority, "environment": environment},
            created_by=self.name,
        )

        return AgentResult(
            output={
                "classified": True,
                "category": category,
                "priority": priority,
                "environment": environment,
                "service_id": str(service_id) if service_id else None,
                "unresolved_service": service_name if service_name and not service_id else None,
            },
            confidence=confidence,
            model=response.get("model"),
        )
