"""The agent roster, its policy, and the guardrails that bound it.

The one part of the system the dashboard never showed. It rendered what the agents
produced and never that there was a roster at all, what each one was allowed to
do, or who had decided that — because until `app/agents/policy.py` existed, the
answer to the last question was "nobody".

Everything writable here is enforced. `agents.is_active` was already read by
`app/agents/registry.py`; autonomy, the risk policy, the skills and the guardrails
are read by the policy gate on every proposal.
"""

from __future__ import annotations

import logging
from datetime import time
from typing import Any, Literal

import asyncpg
from fastapi import APIRouter, Body, Depends, Response
from pydantic import BaseModel, Field, model_validator

from app.agents.intake import ENVIRONMENTS
from app.agents.policy import AUTONOMY_LEVELS, DISPOSITIONS
from app.agents.preflight import DELIVERY_TYPE
from app.tools import registry
from app.api.deps import bad_request, connection, not_found
from app.config import settings
from app.queries import agents as q
from app.rag_client import get_rag_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["agents"])

# What actually invokes each agent, and whether a module exists for it. This
# describes the code, so it lives next to the code rather than in a column: a
# migration cannot know that `Validation Agent` has no class, and a roster that
# showed all eight as equal peers would be the one lie on the page.
#
# Keys are `agents.name`, which is the join key everything else already uses.
INVOCATION: dict[str, dict[str, Any]] = {
    "Incident Intake Agent": {
        "hasModule": True,
        "invokedBy": "ingest",
        "detail": "Runs on every inbound payload, before triage.",
    },
    "Classification Agent": {
        "hasModule": True,
        "invokedBy": "pipeline",
        "detail": "First step of triage. Allowed to fail without stopping the run.",
    },
    "RAG Retrieval Agent": {
        "hasModule": True,
        "invokedBy": "pipeline",
        "detail": "Second step. If it finds nothing, the pipeline stops before proposing.",
    },
    "Decision Agent": {
        "hasModule": True,
        "invokedBy": "pipeline",
        "detail": "Third step, and the only agent that proposes actions.",
    },
    "Execution Agent": {
        "hasModule": True,
        "invokedBy": "approval",
        "detail": "Runs on approval, or unattended when the policy allows it.",
    },
    "Change Delivery Agent": {
        "hasModule": True,
        "invokedBy": "approval",
        "detail": "Dispatched by the Execution Agent for a GITHUB_PR action.",
    },
    "Knowledge Generation Agent": {
        "hasModule": True,
        "invokedBy": "nothing",
        "detail": "Implemented, but no route or pipeline step calls it yet.",
    },
    "Validation Agent": {
        "hasModule": False,
        "invokedBy": "nothing",
        "detail": "Registered here with no module behind it. This is why the funnel's "
        "'Validated + resolved' stage reads as unavailable rather than zero.",
    },
}

UNKNOWN_INVOCATION = {
    "hasModule": False,
    "invokedBy": "unknown",
    "detail": "Seeded into the registry after this map was written.",
}


# What the Decision Agent's prompt tells the planner it may emit
# (app/agents/decision.py:43). Listed here rather than derived, because it is a
# prompt's contents — but which of these can actually run is derived, below, from
# the registry the executor itself consults.
ACTION_TYPE_VOCABULARY = ("API", "WEBHOOK", "GITHUB_PR", "SQL", "LAMBDA", "KUBERNETES")

# The environments an incident can actually carry, from the same map that
# normalises an inbound payload. A skill scoped to anything else could never
# match one.
VALID_ENVIRONMENTS = sorted(set(ENVIRONMENTS.values()))

RISK_LEVELS = ("LOW", "MEDIUM", "HIGH")

# Sentinel for "the caller did not mention this field". None cannot serve: an
# explicit null on serviceId means "unbind this skill from its service", and an
# omitted serviceId means "leave it alone". Collapsing those two would make every
# edit of a skill's name silently clear its service.
UNSET = "__unset__"


class AgentUpdate(BaseModel):
    isActive: bool | None = None
    autonomy: Literal["observe", "suggest", "act_with_approval", "act_autonomously"] | None = None


class RiskPolicyUpdate(BaseModel):
    disposition: Literal["auto_run", "ask_first", "never"]


class SkillFields(BaseModel):
    """Shared validation. Create requires a name and an action type; edit does not."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    actionType: str | None = Field(default=None, min_length=1, max_length=64)
    riskLevel: str | None = None
    environments: list[str] | None = None
    enabled: bool | None = None
    # str so UNSET is expressible alongside a real id and an explicit null.
    serviceId: str | None = UNSET  # type: ignore[assignment]

    @model_validator(mode="after")
    def check(self) -> SkillFields:
        if self.actionType is not None:
            self.actionType = self.actionType.strip().upper()
            if not self.actionType:
                raise ValueError("actionType cannot be blank")
        if self.riskLevel is not None:
            self.riskLevel = self.riskLevel.strip().upper()
            if self.riskLevel not in RISK_LEVELS:
                raise ValueError(f"riskLevel must be one of {', '.join(RISK_LEVELS)}")
        if self.environments is not None:
            unknown = [e for e in self.environments if e not in VALID_ENVIRONMENTS]
            if unknown:
                raise ValueError(
                    f"unknown environment {unknown[0]!r} — an incident can only carry "
                    f"{', '.join(VALID_ENVIRONMENTS)}"
                )
        return self


class SkillCreate(SkillFields):
    name: str = Field(min_length=1, max_length=255)
    actionType: str = Field(min_length=1, max_length=64)


class SkillUpdate(SkillFields):
    pass


class GuardrailsUpdate(BaseModel):
    maxConcurrentExecutions: int | None = Field(default=None, ge=1, le=64)
    neverTouchServices: list[str] | None = None
    # The window is all four fields or none — the schema enforces it, and so does
    # this, because a 422 naming the field is a better answer than a constraint
    # violation rendered as a 500.
    blackoutStartDow: int | None = Field(default=None, ge=1, le=7)
    blackoutStartTime: str | None = None
    blackoutEndDow: int | None = Field(default=None, ge=1, le=7)
    blackoutEndTime: str | None = None
    # Explicit, because "clear the window" and "leave the window alone" are both
    # expressed by four nulls otherwise.
    clearBlackout: bool = False

    @model_validator(mode="after")
    def window_is_whole(self) -> GuardrailsUpdate:
        parts = [
            self.blackoutStartDow,
            self.blackoutStartTime,
            self.blackoutEndDow,
            self.blackoutEndTime,
        ]
        given = [p for p in parts if p is not None]
        if given and len(given) != 4:
            raise ValueError(
                "a blackout window needs all four of blackoutStartDow, blackoutStartTime, "
                "blackoutEndDow and blackoutEndTime — two of four is a window whose meaning "
                "depends on which two"
            )
        if given and self.clearBlackout:
            raise ValueError("clearBlackout and a window are contradictory")
        return self


def _parse_time(value: str | None) -> time | None:
    if value is None:
        return None
    try:
        hour, minute = (int(part) for part in value.split(":")[:2])
        return time(hour, minute)
    except (ValueError, TypeError):
        raise bad_request(f"{value!r} is not a HH:MM time") from None


def _agent(row: asyncpg.Record) -> dict[str, Any]:
    invocation = INVOCATION.get(row["name"], UNKNOWN_INVOCATION)
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "description": row["description"],
        "version": row["version"],
        "isActive": row["is_active"],
        "autonomy": row["autonomy"],
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
        **invocation,
        "runs": {
            "total": row["total_runs"],
            "successful": row["successful_runs"],
            "failed": row["failed_runs"],
            # None rather than 0 when nothing has run: a success rate of zero and
            # no runs at all are different findings, and only one is a problem.
            #
            # v_agent_performance already returns a percentage — it multiplies by
            # 100.0 in the view (011_dashboard_views.sql:62-63). Doing it again
            # here produced 10000%.
            "successRatePercent": (
                round(float(row["success_rate"])) if row["success_rate"] is not None else None
            ),
            "avgConfidence": (
                round(float(row["avg_confidence_score"]), 3)
                if row["avg_confidence_score"] is not None
                else None
            ),
            "avgLatencyMs": (
                round(float(row["avg_latency_ms"])) if row["avg_latency_ms"] is not None else None
            ),
        },
    }


@router.get("/agents")
async def list_agents(conn: asyncpg.Connection = Depends(connection)) -> dict[str, Any]:
    rows = await conn.fetch(q.ROSTER)
    return {
        "agents": [_agent(row) for row in rows],
        # Surfaced so the UI can render `act_autonomously` disabled and say why,
        # rather than offering a level the server will refuse.
        "autonomyEnabled": settings.agent_autonomy_enabled,
        "autonomyLevels": list(AUTONOMY_LEVELS),
    }


@router.get("/agents/{agent_id}")
async def agent_detail(
    agent_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    row = await conn.fetchrow(q.AGENT_BY_ID, agent_id)
    if row is None:
        raise not_found("That agent no longer exists.")

    policy_rows = await conn.fetch(q.RISK_POLICY_FOR_AGENT, row["id"])
    skill_rows = await conn.fetch(q.SKILLS_FOR_AGENT, row["id"])
    usage = {u["action_type"]: u for u in await conn.fetch(q.SKILL_USAGE)}
    context = await conn.fetch(q.CONTEXT_COUNTS)

    return {
        **_agent(row),
        # Ordered by severity rather than alphabetically: the row an operator
        # reads first should be the one that matters most.
        "riskPolicy": [
            {"riskLevel": level, "disposition": _disposition(policy_rows, level)}
            for level in ("HIGH", "MEDIUM", "LOW")
        ],
        "skills": [_skill(s, usage.get(s["action_type"])) for s in skill_rows],
        # The corpus this agent reasons over. Real counts, not a fixed figure.
        "context": [
            {"documentType": c["document_type"], "count": c["count"]} for c in context
        ],
        "prompt": {
            # The orchestrator's agent prompts are Python string literals; the
            # versioned ones belong to RAG Core and are edited in its own admin
            # UI, behind its own key. Saying so beats an Edit button that cannot
            # work.
            "editable": False,
            "note": "This agent's prompt is a literal in app/agents/. Retrieval and "
            "answer prompts are versioned in RAG Core and edited there.",
        },
        "autonomyEnabled": settings.agent_autonomy_enabled,
        "autonomyLevels": list(AUTONOMY_LEVELS),
        "dispositions": list(DISPOSITIONS),
    }


def _disposition(rows: list[asyncpg.Record], level: str) -> str:
    for row in rows:
        if row["risk_level"] == level:
            return row["disposition"]
    # A level with no row is a seeding bug. Reported as the cautious value rather
    # than omitted, so the UI has something to render and the operator is not
    # shown a permission nobody granted.
    logger.warning("no risk policy row for %s", level)
    return "ask_first"


def _skill(row: asyncpg.Record, usage: asyncpg.Record | None) -> dict[str, Any]:
    settled = usage["settled"] if usage else 0
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "description": row["description"],
        "actionType": row["action_type"],
        "riskLevel": row["risk_level"],
        "serviceId": str(row["service_id"]) if row["service_id"] else None,
        "serviceName": row["service_name"],
        "environments": list(row["environments"] or []),
        "enabled": row["enabled"],
        # Per action type, not per skill: a run records the action type it used,
        # never which catalogue entry produced it. Two skills of the same type
        # therefore share these numbers, which is why the label says so.
        "usage": {
            "runs": usage["runs"] if usage else 0,
            "successPercent": (
                round((usage["successes"] / settled) * 100) if usage and settled else None
            ),
            "scope": "action type",
        },
    }


@router.patch("/agents/{agent_id}")
async def update_agent(
    agent_id: str,
    payload: AgentUpdate = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    if payload.isActive is None and payload.autonomy is None:
        raise bad_request("nothing to change")

    # Refused here as well as in the gate. The gate downgrading it at proposal
    # time is the safety net; refusing to store it is the honest answer, so the
    # UI never shows a setting that is not in force.
    if payload.autonomy == "act_autonomously" and not settings.agent_autonomy_enabled:
        raise bad_request(
            "acting autonomously is off on this server; set AGENT_AUTONOMY_ENABLED to allow it"
        )

    updated = await conn.fetchval(q.UPDATE_AGENT, agent_id, payload.isActive, payload.autonomy)
    if updated is None:
        raise not_found("That agent no longer exists.")
    return await agent_detail(agent_id, conn)


@router.patch("/agents/{agent_id}/risk-policy/{risk_level}")
async def update_risk_policy(
    agent_id: str,
    risk_level: str,
    payload: RiskPolicyUpdate = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    level = risk_level.strip().upper()
    if level not in ("LOW", "MEDIUM", "HIGH"):
        raise bad_request(f"{risk_level!r} is not a risk level")

    updated = await conn.fetchval(q.UPSERT_RISK_POLICY, agent_id, level, payload.disposition)
    if updated is None:
        raise not_found("That agent no longer exists.")
    return await agent_detail(agent_id, conn)


@router.get("/action-types")
async def list_action_types() -> dict[str, Any]:
    """The planner's vocabulary, and which of it can actually be carried out.

    `SQL`, `LAMBDA` and `KUBERNETES` are in the Decision Agent's prompt and have
    no executor, so an action of one of those types fails the moment it is
    approved, having attempted nothing. Pre-flight says this on the approval card;
    this endpoint lets a skill form say it before the skill exists.

    Derived from `app/tools.registry()` and DELIVERY_TYPE rather than restated, so
    it cannot disagree with what the executor would do.
    """
    tools = registry()
    return {
        "actionTypes": [
            {
                "actionType": name,
                "hasExecutor": name == DELIVERY_TYPE or name in tools,
                "executor": (
                    "Change Delivery Agent"
                    if name == DELIVERY_TYPE
                    else f"{tools[name].name} tool"
                    if name in tools
                    else None
                ),
            }
            for name in ACTION_TYPE_VOCABULARY
        ],
        "riskLevels": list(RISK_LEVELS),
        "environments": VALID_ENVIRONMENTS,
    }


@router.post("/agents/{agent_id}/skills", status_code=201)
async def create_skill(
    agent_id: str,
    payload: SkillCreate = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    """Add a skill to an agent that can actually use one.

    Refused for any other agent: the policy gate reads skills only for the agent
    that proposes actions (`app/agents/decision.py:181` is its only caller), so a
    skill anywhere else would be a row nothing consults.
    """
    agent = await conn.fetchrow(q.AGENT_BY_ID, agent_id)
    if agent is None:
        raise not_found("That agent no longer exists.")

    invocation = INVOCATION.get(agent["name"], UNKNOWN_INVOCATION)
    if "propose" not in invocation["detail"].lower():
        raise bad_request(
            f"{agent['name']} does not propose actions, so a skill on it would never be "
            "consulted. Only the Decision Agent has skills."
        )

    try:
        await conn.fetchval(
            q.INSERT_SKILL,
            agent_id,
            payload.name,
            payload.description,
            payload.actionType,
            payload.riskLevel or "MEDIUM",
            None if payload.serviceId in (None, UNSET) else payload.serviceId,
            payload.environments or [],
            True if payload.enabled is None else payload.enabled,
        )
    except asyncpg.UniqueViolationError:
        # Otherwise a 500 reading "Something went wrong on the server" for a name
        # the operator can simply change.
        raise bad_request(
            f"{agent['name']} already has a skill called {payload.name!r}"
        ) from None
    except asyncpg.DataError as exc:
        raise bad_request(str(exc)) from None

    return await agent_detail(agent_id, conn)


@router.patch("/skills/{skill_id}")
async def update_skill(
    skill_id: str,
    payload: SkillUpdate = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    touching_service = payload.serviceId is not UNSET

    try:
        agent_id = await conn.fetchval(
            q.UPDATE_SKILL_FIELDS,
            skill_id,
            payload.name,
            payload.description,
            payload.actionType,
            payload.riskLevel,
            payload.environments,
            payload.enabled,
            touching_service,
            payload.serviceId if touching_service else None,
        )
    except asyncpg.UniqueViolationError:
        raise bad_request(f"a skill called {payload.name!r} already exists on this agent") from None
    except asyncpg.DataError as exc:
        raise bad_request(str(exc)) from None

    if agent_id is None:
        raise not_found("That skill no longer exists.")
    return await agent_detail(str(agent_id), conn)


@router.delete("/skills/{skill_id}")
async def delete_skill(
    skill_id: str, conn: asyncpg.Connection = Depends(connection)
) -> dict[str, Any]:
    """Remove a skill outright.

    Distinct from switching it off, which leaves an inert row behind. Both are
    useful: off is reversible and keeps the history, removed is for the one
    created by mistake.
    """
    agent_id = await conn.fetchval(q.DELETE_SKILL, skill_id)
    if agent_id is None:
        raise not_found("That skill no longer exists.")
    return await agent_detail(str(agent_id), conn)


def _guardrails(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "maxConcurrentExecutions": row["max_concurrent_executions"],
        "neverTouchServices": list(row["never_touch_services"] or []),
        "blackout": (
            {
                "startDow": row["blackout_start_dow"],
                "startTime": row["blackout_start_time"].strftime("%H:%M"),
                "endDow": row["blackout_end_dow"],
                "endTime": row["blackout_end_time"].strftime("%H:%M"),
            }
            if row["blackout_start_dow"] is not None
            else None
        ),
    }


@router.get("/guardrails")
async def get_guardrails(conn: asyncpg.Connection = Depends(connection)) -> dict[str, Any]:
    row = await conn.fetchrow(q.GUARDRAILS)
    if row is None:
        raise not_found("Guardrails have not been seeded.")
    return _guardrails(row)


@router.patch("/guardrails")
async def update_guardrails(
    payload: GuardrailsUpdate = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    touching_window = payload.clearBlackout or payload.blackoutStartDow is not None
    await conn.execute(
        q.UPDATE_GUARDRAILS,
        payload.maxConcurrentExecutions,
        payload.neverTouchServices,
        touching_window,
        None if payload.clearBlackout else payload.blackoutStartDow,
        None if payload.clearBlackout else _parse_time(payload.blackoutStartTime),
        None if payload.clearBlackout else payload.blackoutEndDow,
        None if payload.clearBlackout else _parse_time(payload.blackoutEndTime),
    )
    return await get_guardrails(conn)


@router.get("/connections")
async def list_connections() -> dict[str, Any]:
    """The knowledge sources RAG Core is configured to poll.

    Read-only, and read-only on purpose. Editing a source means handling its
    credentials, and the RAG key this service holds has admin scope over
    /v1/secrets — proxying that through an endpoint with no authentication would
    make this a confused deputy. RAG Core has its own admin UI behind its own key.

    There is also no "connected" state to report: `last_status` is written after a
    poll and is NULL until the first one, so a source that has never run is
    neither connected nor disconnected. It is unknown, and it says so.
    """
    try:
        sources = await get_rag_client().list_sources()
    except Exception as exc:  # noqa: BLE001 — the RAG being down must not blank the tab
        logger.warning("could not read sources from RAG Core: %s", exc)
        return {
            "sources": [],
            "unavailable": "RAG Core did not answer, so its sources cannot be listed.",
        }

    return {
        "sources": [
            {
                "id": s.get("id"),
                "name": s.get("name"),
                "type": s.get("type"),
                "collection": s.get("collection"),
                "enabled": s.get("enabled"),
                "lastRunAt": s.get("last_run_at"),
                # 'ok' | 'error' | None. None means it has never run — deliberately
                # not folded into 'error'.
                "lastStatus": s.get("last_status"),
                "lastError": s.get("last_error"),
            }
            for s in (sources or [])
        ],
        "unavailable": None,
    }
