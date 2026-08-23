"""Execution Agent — carries out an action a human approved.

The only agent in the system with side effects outside this database, which is
why it is the most conservative one: it runs a registered tool or it fails
saying there is none. It never improvises a way to carry something out.

It also owns the row the dashboard is polling. An execution left in RUNNING is
not neutral — the card polls it forever and the operator is told the remediation
is still working. Every path here ends in a terminal status.
"""

from __future__ import annotations

import asyncio
import json
import logging
import traceback
from typing import Any, ClassVar

import asyncpg

from app.agents import events
from app.agents.base import Agent, AgentResult
from app.config import settings
from app.db import get_pool
from app.tools import ToolResult, UnregisteredTool, tool_for

logger = logging.getLogger(__name__)

# Locked: two approvals racing must not both drive the same execution.
LOAD_EXECUTION = """
SELECT e.id, e.status, ra.id AS action_id, ra.action_type, ra.parameters,
       ra.description, ra.incident_id
FROM executed_actions e
JOIN recommended_actions ra ON ra.id = e.recommended_action_id
WHERE e.id = $1
FOR UPDATE OF e
"""

INCIDENT = """
SELECT i.id, i.external_id, i.title, i.description, i.status, i.priority,
       i.category, i.source, i.environment, i.is_known_incident, i.service_id,
       s.name AS service_name,
       -- The authoritative repository for a code change. Present in the schema
       -- since the beginning and read by nothing until the delivery agent.
       s.repository_url
FROM incidents i
LEFT JOIN services s ON s.id = i.service_id
WHERE i.id = $1
"""

FINISH = """
UPDATE executed_actions
   SET status = $2::execution_status,
       finished_at = now(),
       request_payload = $3::jsonb,
       response_payload = $4::jsonb,
       execution_logs = $5,
       error_message = $6
 WHERE id = $1
"""

# A recommendation is EXECUTED once something ran for it, whatever the outcome —
# the outcome lives on the execution row.
MARK_EXECUTED = "UPDATE recommended_actions SET status = 'EXECUTED' WHERE id = $1"

# Compare-and-set on RUNNING, so it is safe to call unconditionally and safe to
# call twice. `status` is the real guard here, not the row lock.
SETTLE = """
UPDATE executed_actions
   SET status = 'FAILED', finished_at = now(), error_message = $2
 WHERE id = $1 AND status = 'RUNNING'
"""


class ExecutionAgent(Agent):
    name: ClassVar[str] = "Execution Agent"

    def __init__(self, execution_id: str) -> None:
        self._execution_id = execution_id

    def describe_input(self, incident: asyncpg.Record) -> dict[str, Any]:
        return {"incident_id": str(incident["id"]), "executed_action_id": self._execution_id}

    async def handle(
        self, conn: asyncpg.Connection, incident: asyncpg.Record, run_id: str
    ) -> AgentResult:
        row = await conn.fetchrow(LOAD_EXECUTION, self._execution_id)
        if row is None:
            return AgentResult(output={"executed": False, "reason": "execution row is gone"})
        if row["status"] != "RUNNING":
            # Already settled — a retry, or another worker got here first.
            return AgentResult(
                output={"executed": False, "reason": f"already {row['status']}"}
            )

        parameters = json.loads(row["parameters"]) if row["parameters"] else {}
        action_type = row["action_type"]

        # Everything the executor might do is inside this try, so there is exactly
        # one FINISH below and it is unconditional. An exception escaping here
        # would close the agent run as FAILED and leave executed_actions in
        # RUNNING forever — the card polling a remediation that is not running.
        try:
            if action_type == "GITHUB_PR":
                # Delivering a code change needs a connection, the incident and a
                # run row of its own — none of which the Tool protocol provides,
                # which is why it is a sub-agent rather than a tool. It gets its
                # own line in the operator's trace, but this method stays the
                # only writer of executed_actions: two owners would mean two
                # paths that can leave the row RUNNING.
                result = await self._deliver(conn, incident, row, parameters)
            else:
                tool = tool_for(action_type)
                logger.info("executing %s via %s", row["action_id"], tool.name)
                result = await tool.run(parameters)
        except UnregisteredTool as exc:
            # Terminal and honest. Better than RUNNING forever, which tells the
            # operator the remediation is still working when nothing is.
            result = ToolResult(
                ok=False,
                error=str(exc),
                logs=f"No tool is registered for {action_type}. Nothing was attempted.",
            )
        except Exception as exc:  # noqa: BLE001 — a raising executor must still settle the row
            logger.exception("executor for %s raised on %s", action_type, row["action_id"])
            result = ToolResult(
                ok=False,
                error=f"{action_type} execution failed: {exc}",
                logs=traceback.format_exc()[-2000:],
            )

        status = "SUCCESS" if result.ok else "FAILED"
        await conn.execute(
            FINISH,
            self._execution_id,
            status,
            json.dumps(parameters),
            json.dumps(result.response) if result.response else None,
            result.logs or None,
            result.error,
        )
        await conn.execute(MARK_EXECUTED, row["action_id"])

        await events.record_event(
            conn,
            str(row["incident_id"]),
            events.ACTION_EXECUTED if result.ok else events.VALIDATION_FAILED,
            (
                f"{action_type} executed — {row['description']}"
                if result.ok
                else f"{action_type} failed — {result.error}"
            ),
            payload={"executed_action_id": self._execution_id},
            created_by=self.name,
        )

        return AgentResult(
            output={
                "executed": True,
                "status": status,
                "action_type": action_type,
                "error": result.error,
            }
        )


    async def _deliver(
        self,
        conn: asyncpg.Connection,
        incident: asyncpg.Record,
        row: asyncpg.Record,
        parameters: dict[str, Any],
    ) -> ToolResult:
        from app.agents.change_delivery import ChangeDeliveryAgent
        from app.rag_client import get_rag_client

        agent = ChangeDeliveryAgent(dict(row), parameters, get_rag_client())
        outcome = await agent.execute(conn, incident)

        if outcome is None:
            # The sub-agent's run is already closed FAILED with its own error.
            return ToolResult(ok=False, error="the change could not be delivered")

        output = dict(outcome.output)
        logs = output.pop("logs", "") or ""
        if not output.get("delivered"):
            return ToolResult(ok=False, error=output.get("reason"), response=output, logs=logs)
        return ToolResult(ok=True, response=output, logs=logs)



async def run_execution(conn: asyncpg.Connection, execution_id: str) -> AgentResult | None:
    row = await conn.fetchrow(
        "SELECT ra.incident_id FROM executed_actions e "
        "JOIN recommended_actions ra ON ra.id = e.recommended_action_id WHERE e.id = $1",
        execution_id,
    )
    if row is None:
        raise LookupError(f"no execution with id {execution_id}")
    incident = await conn.fetchrow(INCIDENT, row["incident_id"])

    try:
        async with conn.transaction():
            return await ExecutionAgent(execution_id).execute(conn, incident)
    finally:
        # Outside the transaction on purpose. Anything that fails after FINISH
        # rolls the FINISH back with it, so the row can still be RUNNING here
        # even though the agent believed it had closed it.
        await settle_if_running(
            conn, execution_id, "the executor did not report an outcome"
        )


async def settle_if_running(conn: asyncpg.Connection, execution_id: str, reason: str) -> None:
    """Close an execution that is still RUNNING. A no-op when it already settled."""
    result = await conn.execute(SETTLE, execution_id, reason)
    if result != "UPDATE 0":
        logger.warning("settled orphaned execution %s: %s", execution_id, reason)


ORPHANED = "SELECT id FROM executed_actions WHERE status = 'RUNNING'"


async def settle_orphans(conn: asyncpg.Connection) -> int:
    """Close executions left RUNNING by a process that died mid-flight.

    Background tasks do not survive a restart, so without this a container
    bounced mid-execution leaves a card polling a remediation that no longer has
    anything running behind it.
    """
    rows = await conn.fetch(ORPHANED)
    for row in rows:
        await settle_if_running(
            conn, str(row["id"]), "the orchestrator restarted while this was running"
        )
    return len(rows)


async def execute_in_background(execution_id: str) -> None:
    """Carry out a settled action on its own connection, bounded and always settled.

    Two callers, and there must only ever be one of these: the approve endpoint,
    and the pipeline when a policy says an action may run unattended. A second
    implementation of "start an execution" would be a second place for an
    execution to get stuck in RUNNING.

    Its own connection, because a request's connection is released the moment the
    response is sent — a background task holding it would be using a connection
    that has already gone back to the pool.
    """
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            # Bounded so a wedged executor cannot hold a pool connection for the
            # life of the process. The timeout is only safe because the settle
            # below turns it into a closed execution rather than a stuck one.
            await asyncio.wait_for(
                run_execution(conn, execution_id),
                timeout=settings.execution_total_timeout_seconds,
            )
    except TimeoutError:
        logger.warning("execution %s exceeded its time budget", execution_id)
        async with pool.acquire() as conn:
            await settle_if_running(
                conn,
                execution_id,
                f"gave up after {settings.execution_total_timeout_seconds:.0f}s",
            )
    except Exception as exc:  # noqa: BLE001
        # Logging alone would leave the card polling forever. Settle on a fresh
        # connection — whatever failed may have been the connection itself.
        logger.exception("execution %s failed outside the agent", execution_id)
        try:
            async with pool.acquire() as conn:
                await settle_if_running(conn, execution_id, f"execution failed: {exc}")
        except Exception:  # noqa: BLE001
            logger.exception("could not settle execution %s", execution_id)
