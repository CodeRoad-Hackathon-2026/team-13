"""Decision Agent — asks RAG Core for a grounded remediation and records it as a
`recommended_actions` row for the dashboard's approval queue.

Uses /v1/answer, not /v1/search: this step needs the corpus reasoned over, with
citations and RAG Core's own abstention and groundedness judgement applied.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, ClassVar

import asyncpg

from app.agents import events, policy
from app.agents.base import Agent, AgentFailed, AgentResult, to_numeric
from app.agents.parsing import extract_json_object
from app.agents.patch import parse_unified_diff
from app.rag_client import RagClient, RagError

logger = logging.getLogger(__name__)

RISK_LEVELS = {"LOW", "MEDIUM", "HIGH"}

PROMPT = """\
You are the remediation planner for an incident response system.

Incident: {title}
Description: {description}
Service: {service}
Environment: {environment}
Category: {category}

Using only the retrieved runbooks, past incidents and postmortems, propose the
single remediation action to take now.

Reply with one JSON object and nothing else:
{{"action_type": "...", "description": "...", "parameters": {{}},
  "risk_level": "LOW|MEDIUM|HIGH"}}

action_type is the tool that performs it (SQL, LAMBDA, API, GITHUB_PR,
KUBERNETES, ...). parameters holds exactly what that tool needs.

When the fix is a change to code or configuration, use GITHUB_PR and put the
change in parameters as a unified diff:

{{"action_type": "GITHUB_PR", "description": "...", "risk_level": "...",
  "parameters": {{"repo": "org/service", "branch": "remediate/<slug>",
                 "base": "main", "summary": "...",
                 "diff": "--- a/path/file\\n+++ b/path/file\\n@@ -41,6 +41,7 @@\\n ..."}}}}

Use the real line numbers the runbook shows. Never invent a file the sources do
not mention.

If the sources do not support a specific action, say so in prose instead of
guessing a JSON object.
"""


def parse_action(answer: str) -> dict[str, Any] | None:
    """Pull the action object out of the model's reply.

    Returns None when there is no object to find — the documented way for the
    planner to decline, not an error.
    """
    return extract_json_object(answer)


class DecisionAgent(Agent):
    name: ClassVar[str] = "Decision Agent"

    def __init__(self, rag: RagClient) -> None:
        self._rag = rag

    def describe_input(self, incident: asyncpg.Record) -> dict[str, Any]:
        return {
            "incident_id": str(incident["id"]),
            "title": incident["title"],
            "category": incident["category"],
            "environment": incident["environment"],
        }

    async def handle(
        self, conn: asyncpg.Connection, incident: asyncpg.Record, run_id: str
    ) -> AgentResult:
        incident_id = str(incident["id"])
        prompt = PROMPT.format(
            title=incident["title"],
            description=incident["description"] or "(none supplied)",
            service=incident["service_name"] or "unknown",
            environment=incident["environment"] or "unknown",
            category=incident["category"] or "unclassified",
        )

        try:
            response = await self._rag.answer(prompt, incident_id=incident_id)
        except RagError as exc:
            raise AgentFailed(f"answer failed: {exc}") from exc

        usage = response.get("usage") or {}
        base = AgentResult(
            output={},
            confidence=response.get("confidence"),
            model=response.get("model"),
            tokens_input=_total(usage, "input"),
            tokens_output=_total(usage, "output"),
            prompt_version=_first_prompt_version(response.get("prompt_versions")),
        )

        # RAG Core abstained: the corpus did not support an answer. A real
        # outcome, not a fault — the run succeeds having proposed nothing.
        if response.get("abstained"):
            reason = response.get("abstain_reason") or "insufficient grounding"
            await events.record_event(
                conn,
                incident_id,
                events.VALIDATION_FAILED,
                f"No remediation proposed — {reason}",
                payload={"query_log_id": response.get("query_log_id")},
            )
            base.output = {"proposed": False, "reason": reason, "abstained": True}
            return base

        action = parse_action(response.get("answer") or "")
        if action is None:
            base.output = {
                "proposed": False,
                "reason": "the planner returned prose instead of an action",
                "abstained": False,
            }
            return base

        action_type = str(action.get("action_type") or "").strip().upper()
        if not action_type:
            # Structured reply that names no tool is malformed, not a decline —
            # nothing downstream could execute it.
            raise AgentFailed("proposed action has no action_type")

        risk = str(action.get("risk_level") or "MEDIUM").strip().upper()
        if risk not in RISK_LEVELS:
            logger.warning("unknown risk_level %r on incident %s, storing MEDIUM", risk, incident_id)
            risk = "MEDIUM"

        parameters = action.get("parameters")
        if not isinstance(parameters, dict):
            parameters = {}

        # A proposed code change arrives as a unified diff. Parsed here rather
        # than in the browser so the stored parameters already hold what the
        # viewer renders, and so a diff the planner mangled is caught now.
        change = None
        if isinstance(parameters.get("diff"), str):
            parsed = parse_unified_diff(parameters["diff"])
            if parsed["files"]:
                change = {
                    "repo": str(parameters.get("repo") or "").strip() or None,
                    "branch": str(parameters.get("branch") or "").strip() or None,
                    "base": str(parameters.get("base") or "main").strip(),
                    "summary": str(parameters.get("summary") or "").strip() or None,
                    **parsed,
                }
                parameters["proposedChange"] = change
            else:
                # The planner claimed a diff and produced something unreadable.
                # Kept as raw text so a human can still see what it meant, but
                # not presented as a change we understood.
                logger.warning("unparseable diff on incident %s", incident_id)

        description = str(action.get("description") or "").strip() or incident["title"]

        # Whether a human sees this, and whether it may run unattended. This used
        # to be the literal TRUE in the SQL below, which meant the risk level the
        # planner was asked to assign decided nothing.
        verdict = policy.decide(
            action_type=action_type,
            risk_level=risk,
            service_name=incident["service_name"],
            now=datetime.now(timezone.utc),
            **await policy.load_inputs(conn, self.name),
        )

        if verdict["disposition"] == "suppressed":
            # No row, but an event — a proposal a policy withheld and an agent
            # that found nothing are different things, and the timeline is where
            # an operator goes to tell them apart.
            await events.record_event(
                conn,
                incident_id,
                events.ACTION_SUPPRESSED,
                f"{action_type} withheld · risk {risk} — {verdict['reason']}",
                payload={
                    "action_type": action_type,
                    "risk_level": risk,
                    "rule": verdict["rule"],
                },
                created_by=self.name,
            )
            base.output = {
                "proposed": False,
                "reason": verdict["reason"],
                "policy_rule": verdict["rule"],
                "abstained": False,
                "citations": response.get("citations") or [],
                "query_log_id": response.get("query_log_id"),
            }
            return base

        approval_required = verdict["disposition"] == "ask_first"

        action_id = await conn.fetchval(
            """
            INSERT INTO recommended_actions
                (incident_id, agent_run_id, action_type, description, parameters,
                 risk_level, confidence_score, approval_required, status)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::risk_level, $7, $8, 'PROPOSED')
            RETURNING id
            """,
            incident_id,
            run_id,
            action_type,
            description,
            json.dumps(parameters),
            risk,
            to_numeric(response.get("confidence"), 4),
            approval_required,
        )

        await events.record_event(
            conn,
            incident_id,
            events.ACTION_RECOMMENDED,
            f"{action_type} proposed · risk {risk} — {description}",
            payload={
                "recommended_action_id": str(action_id),
                "citations": len(response.get("citations") or []),
                "approval_required": approval_required,
                "policy_rule": verdict["rule"],
            },
            created_by=self.name,
        )

        base.output = {
            "proposed": True,
            "recommended_action_id": str(action_id),
            "action_type": action_type,
            "risk_level": risk,
            "approval_required": approval_required,
            "policy_rule": verdict["rule"],
            "changed_files": len(change["files"]) if change else 0,
            "citations": response.get("citations") or [],
            "query_log_id": response.get("query_log_id"),
        }
        base.extras["recommended_action_id"] = str(action_id)
        base.extras["approval_required"] = approval_required
        return base


def _total(usage: dict[str, Any], side: str) -> int | None:
    """Sum tokens across RAG Core's per-call breakdown.

    Generation and the groundedness judge are separate calls, so the usage map
    is nested per model call rather than a single pair of totals.
    """
    total = 0
    found = False
    for value in usage.values():
        if isinstance(value, dict) and isinstance(value.get(side), int):
            total += value[side]
            found = True
    return total if found else None


def _first_prompt_version(versions: Any) -> str | None:
    """The id of the prompt that produced this answer.

    RAG Core reports one entry per prompt it used, and each entry is an object,
    not a string — stringifying it whole stores a truncated dict where a version
    id belongs, which traces nothing.
    """
    if not isinstance(versions, dict) or not versions:
        return None
    first = next(iter(versions.values()))
    if isinstance(first, dict):
        for key in ("version_id", "id", "version"):
            if first.get(key):
                return str(first[key])
        return None
    return str(first)
