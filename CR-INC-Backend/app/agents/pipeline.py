"""Runs the agents over one incident, in order.

Each agent commits its own transaction. A Decision failure must not roll back the
similarity matches Retrieval already recorded — the operator should still see
what was found, even when the planner then fell over.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import asyncpg

from app.agents import events
from app.agents.base import AgentResult
from app.agents.classification import ClassificationAgent
from app.agents.decision import DecisionAgent
from app.agents.intake import ingest_incident
from app.agents.execution import execute_in_background
from app.agents.retrieval import RagRetrievalAgent
from app.db import get_pool
from app.queries import approvals as q
from app.rag_client import RagClient

logger = logging.getLogger(__name__)

# service_name is joined in because two agents put it in their prompt; the
# incidents table only carries the foreign key.
INCIDENT_SQL = """
SELECT i.id, i.external_id, i.title, i.description, i.status, i.priority,
       i.category, i.source, i.environment, i.is_known_incident,
       s.name AS service_name
  FROM incidents i
  LEFT JOIN services s ON s.id = i.service_id
 WHERE i.id = $1
"""


class IncidentNotFound(LookupError):
    def __init__(self, incident_id: str) -> None:
        super().__init__(f"no incident with id {incident_id}")


async def triage_incident(incident_id: str, rag: RagClient | None = None) -> dict[str, Any]:
    """Classify, retrieve, then decide. Returns what each step concluded.

    Stops after retrieval if it failed: proposing a remediation with no evidence
    behind it is exactly what this system exists to avoid. Classification is
    allowed to fail without stopping the run — an unclassified incident can still
    be matched against the corpus on its title and description alone.
    """
    pool = await get_pool()
    client = rag or RagClient()
    owns_client = rag is None

    try:
        async with pool.acquire() as conn:
            incident = await conn.fetchrow(INCIDENT_SQL, incident_id)
            if incident is None:
                raise IncidentNotFound(incident_id)

            async with conn.transaction():
                classification = await ClassificationAgent(client).execute(conn, incident)

            # Re-read between every step: each agent writes to the incident, and
            # the next one's prompt should see it as it now stands.
            incident = await conn.fetchrow(INCIDENT_SQL, incident_id)

            async with conn.transaction():
                retrieval = await RagRetrievalAgent(client).execute(conn, incident)

            if retrieval is None:
                logger.warning("retrieval failed for %s — not proposing an action", incident_id)
                return {
                    "classification": _summarise(classification),
                    "retrieval": None,
                    "decision": None,
                }

            incident = await conn.fetchrow(INCIDENT_SQL, incident_id)

            async with conn.transaction():
                decision = await DecisionAgent(client).execute(conn, incident)

            # An action the policy cleared to run unattended. Started here rather
            # than left PROPOSED: approval_required = FALSE had full support on
            # the read side and nothing that ever acted on it, so a "fully
            # automated" action sat forever looking automated and doing nothing.
            #
            # Outside the transaction above, and on the same one entry point the
            # approve endpoint uses — the execution row must be committed and
            # visible before anything starts polling it.
            execution_id = await _start_unattended_execution(conn, incident_id, decision)

        if execution_id is not None:
            asyncio.create_task(execute_in_background(execution_id))

        return {
            "classification": _summarise(classification),
            "retrieval": _summarise(retrieval),
            "decision": _summarise(decision),
            "unattendedExecutionId": execution_id,
        }
    finally:
        if owns_client:
            await client.aclose()


async def intake_and_triage(
    payload: dict[str, Any], rag: RagClient | None = None
) -> dict[str, Any]:
    """The whole pipeline: intake, then classify, retrieve and decide.

    A replayed webhook re-triages the existing incident rather than opening a
    second one — the same alert arriving twice is one incident.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        incident, created = await ingest_incident(conn, payload)

    result = await triage_incident(str(incident["id"]), rag)
    return {"incidentId": str(incident["id"]), "created": created, **result}


async def _start_unattended_execution(
    conn: asyncpg.Connection, incident_id: str, decision: AgentResult | None
) -> str | None:
    """Open the execution row for an action no human has to approve.

    `executed_by` is the agent's own name, not a person's: `executed_actions`
    already carries who ran a thing, and writing an operator's name for something
    no operator saw would make the audit trail lie in the one place it exists to
    be trusted.
    """
    if decision is None:
        return None
    action_id = decision.extras.get("recommended_action_id")
    if not action_id or decision.extras.get("approval_required") is not False:
        return None

    execution_id = await conn.fetchval(q.START_EXECUTION, action_id, DecisionAgent.name)
    await events.record_event(
        conn,
        incident_id,
        events.ACTION_EXECUTED,
        "Running unattended — the policy for this risk level is auto-run.",
        payload={
            "recommended_action_id": str(action_id),
            "executed_action_id": str(execution_id),
            "policy_rule": decision.output.get("policy_rule") if decision.output else None,
        },
        created_by=DecisionAgent.name,
    )
    logger.info("policy cleared %s to run unattended as %s", action_id, execution_id)
    return str(execution_id)


def _summarise(result: AgentResult | None) -> dict[str, Any] | None:
    if result is None:
        return None
    return {"output": result.output, "confidence": result.confidence, **result.extras}
