"""The one contract every agent runs under.

`agent_runs` is what the dashboard's drawer renders as the agent trace, so the
row is opened *before* the work starts and closed in a `finally` — a run that
crashes must end as FAILED with its error, never linger as RUNNING. That is
also why the row is written on its own connection and committed per step: a
Decision failure must not roll back the retrieval that already succeeded.
"""

from __future__ import annotations

import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, ClassVar

import asyncpg

from app.agents.registry import agent_id_for

logger = logging.getLogger(__name__)


def to_numeric(value: float | None, places: int) -> Decimal | None:
    """Clamp to 0..1 and quantise for a NUMERIC column.

    asyncpg will not coerce a float into NUMERIC, and every score column here
    carries a CHECK between 0 and 1 — a reranker score above 1 would otherwise
    abort the whole insert.
    """
    if value is None:
        return None
    clamped = min(1.0, max(0.0, float(value)))
    return Decimal(str(round(clamped, places)))


def fit(value: str | None, width: int) -> str | None:
    """Trim a string to what its column will accept.

    These are provenance fields, not data: `model` and `prompt_version` exist so
    a run can be traced back, and a truncated identifier still traces. Letting
    an over-long one through instead aborts the UPDATE that closes the run —
    which is how a completed step ends up with no run row at all.
    """
    if value is None:
        return None
    return value[:width]


# Column widths from db/migrations/006_agents_agent_runs.sql.
MODEL_WIDTH = 100
PROMPT_VERSION_WIDTH = 50


@dataclass
class AgentResult:
    """What an agent hands back for its own run row."""

    output: dict[str, Any]
    confidence: float | None = None
    model: str | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    prompt_version: str | None = None
    # Side effects the caller may want to chain on, never persisted as-is.
    extras: dict[str, Any] = field(default_factory=dict)


class AgentFailed(RuntimeError):
    """Raised by an agent when the step genuinely failed.

    Distinct from an agent that ran fine and concluded "nothing to propose" —
    that is a SUCCESS with a negative result, and marking it FAILED would paint
    a normal outcome red in the operator's trace.
    """


class Agent(ABC):
    #: Must match a row in `agents` (db/seeds/001_agents.sql).
    name: ClassVar[str]

    @abstractmethod
    async def handle(
        self, conn: asyncpg.Connection, incident: asyncpg.Record, run_id: str
    ) -> AgentResult:
        """Do the work. Raise AgentFailed for a real fault.

        `run_id` is this run's own agent_runs.id, passed in rather than looked up
        so an agent can attribute what it writes (a recommended action, say) to
        the run that produced it.
        """

    def describe_input(self, incident: asyncpg.Record) -> dict[str, Any]:
        """What to store in agent_runs.input — overridable per agent.

        P-4 territory: this is JSONB the dashboard fetches lazily, so it should
        be what a human needs to understand the step, not the whole record.
        """
        return {"incident_id": str(incident["id"]), "title": incident["title"]}

    async def execute(self, conn: asyncpg.Connection, incident: asyncpg.Record) -> AgentResult | None:
        """Run the agent with its full `agent_runs` lifecycle.

        Returns None when the step failed, so a pipeline can stop without
        having to catch — the failure is already recorded and visible.
        """
        agent_id = await agent_id_for(conn, self.name)
        incident_id = str(incident["id"])

        run_id = await conn.fetchval(
            """
            INSERT INTO agent_runs (incident_id, agent_id, status, input)
            VALUES ($1, $2, 'RUNNING', $3::jsonb)
            RETURNING id
            """,
            incident_id,
            agent_id,
            json.dumps(self.describe_input(incident)),
        )

        started = time.perf_counter()
        try:
            result = await self.handle(conn, incident, str(run_id))
        except Exception as exc:  # noqa: BLE001 — every failure must close the run
            latency_ms = int((time.perf_counter() - started) * 1000)
            logger.exception("%s failed on incident %s", self.name, incident_id)
            await conn.execute(
                """
                UPDATE agent_runs
                   SET status = 'FAILED',
                       finished_at = now(),
                       latency_ms = $2,
                       error_message = $3
                 WHERE id = $1
                """,
                run_id,
                latency_ms,
                str(exc)[:2000],
            )
            return None

        latency_ms = int((time.perf_counter() - started) * 1000)
        try:
            # Nested transaction: asyncpg turns this into a savepoint, so a
            # failure here rolls back only the UPDATE. Without it the whole
            # surrounding transaction is aborted and the fallback below cannot
            # run either — every statement after a failed one errors until
            # rollback.
            async with conn.transaction():
                await self._close_succeeded(conn, run_id, result, latency_ms)
        except Exception as exc:  # noqa: BLE001
            # The work succeeded but recording it did not — a bad output shape,
            # a value the column rejects. Close the run as FAILED rather than let
            # this propagate: an exception here unwinds the caller's transaction
            # and takes the RUNNING row with it, leaving no trace that the step
            # ever ran.
            logger.exception("%s could not record its result on incident %s", self.name, incident_id)
            await conn.execute(
                """
                UPDATE agent_runs
                   SET status = 'FAILED', finished_at = now(), latency_ms = $2, error_message = $3
                 WHERE id = $1
                """,
                run_id,
                latency_ms,
                f"agent succeeded but its run could not be recorded: {exc}"[:2000],
            )
            return None

        result.extras["agent_run_id"] = str(run_id)
        return result

    async def _close_succeeded(
        self, conn: asyncpg.Connection, run_id: Any, result: AgentResult, latency_ms: int
    ) -> None:
        await conn.execute(
            """
            UPDATE agent_runs
               SET status = 'SUCCESS',
                   finished_at = now(),
                   output = $2::jsonb,
                   confidence_score = $3,
                   latency_ms = $4,
                   model = $5,
                   tokens_input = $6,
                   tokens_output = $7,
                   prompt_version = $8
             WHERE id = $1
            """,
            run_id,
            json.dumps(result.output),
            to_numeric(result.confidence, 4),
            latency_ms,
            fit(result.model, MODEL_WIDTH),
            result.tokens_input,
            result.tokens_output,
            fit(result.prompt_version, PROMPT_VERSION_WIDTH),
        )
