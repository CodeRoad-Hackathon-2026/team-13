"""Whether a human sees this action, decided once and for a stated reason.

Until this existed, `decision.py` wrote `approval_required` as the literal `TRUE`
in its INSERT. The Decision Agent was asked for a `risk_level`, the value was
validated and stored, and then nothing read it to decide anything — so no
proposal the live pipeline made could ever run without a person, at any risk
level, and the read side's support for `approval_required = FALSE` was exercised
only by seed rows.

Shaped like `preflight.py` on purpose: a pure function, no I/O, returning a
verdict *and* the sentence that justifies it. An operator who finds their queue
empty needs to know which rule emptied it, and the same string that goes in the
API response goes in the incident timeline.

The order of the rules is the whole design. Read `decide` top to bottom.
"""

from __future__ import annotations

import logging
from datetime import datetime, time
from typing import Any, Literal

from app.config import settings

logger = logging.getLogger(__name__)

Disposition = Literal["auto_run", "ask_first", "suppressed"]

AUTONOMY_LEVELS = ("observe", "suggest", "act_with_approval", "act_autonomously")
DISPOSITIONS = ("auto_run", "ask_first", "never")


def _verdict(disposition: Disposition, rule: str, reason: str) -> dict[str, Any]:
    return {"disposition": disposition, "rule": rule, "reason": reason}


def in_blackout_window(
    now: datetime,
    start_dow: int | None,
    start_time: time | None,
    end_dow: int | None,
    end_time: time | None,
) -> bool:
    """Is `now` inside a weekly window that may wrap past Sunday?

    Kept separate and total because the wrapping case is the one worth testing:
    "Fri 16:00 — Mon 06:00" is the window an on-call rota actually wants, and it
    is the one a naive start <= now <= end comparison gets backwards.
    """
    if start_dow is None or start_time is None or end_dow is None or end_time is None:
        return False

    # Minutes since Monday 00:00, so a week is one number line and the only
    # special case left is whether the window crosses its end.
    def minutes(dow: int, at: time) -> int:
        return (dow - 1) * 24 * 60 + at.hour * 60 + at.minute

    current = minutes(now.isoweekday(), time(now.hour, now.minute))
    start = minutes(start_dow, start_time)
    end = minutes(end_dow, end_time)

    if start <= end:
        return start <= current < end
    # Wraps through the end of the week: inside means after the start OR before
    # the end, not between them.
    return current >= start or current < end


def _matching_skill(
    skills: list[dict[str, Any]], action_type: str, service_name: str | None
) -> dict[str, Any] | None:
    """The skill this action would use, most specific first.

    A skill bound to a service wins over one bound to none: an operator who
    disabled "Purge CDN cache" for checkout-web meant that service, and letting
    an unbound skill of the same action type re-enable it would quietly undo
    them.
    """
    candidates = [s for s in skills if s.get("action_type") == action_type]
    if not candidates:
        return None

    if service_name:
        bound = [
            s
            for s in candidates
            if s.get("service_name")
            and str(s["service_name"]).lower() == service_name.lower()
        ]
        if bound:
            return bound[0]

    unbound = [s for s in candidates if not s.get("service_name")]
    return unbound[0] if unbound else None


def decide(
    *,
    action_type: str,
    risk_level: str,
    autonomy: str,
    risk_policy: dict[str, str],
    skills: list[dict[str, Any]],
    guardrails: dict[str, Any],
    service_name: str | None,
    running_executions: int,
    now: datetime,
) -> dict[str, Any]:
    """What happens to this proposed action.

    `risk_policy` maps a risk level to a disposition; `skills` is this agent's
    catalogue, each with `action_type`, `service_name` and `enabled`.
    """
    risk = (risk_level or "MEDIUM").strip().upper()

    # ---- suppression, most restrictive first -----------------------------
    # Never-touch comes first because it is the only rule that is about the
    # target rather than about the agent: no autonomy setting and no policy
    # should be able to reach a service an operator has fenced off.
    never_touch = [str(s).lower() for s in (guardrails.get("never_touch_services") or [])]
    if service_name and service_name.lower() in never_touch:
        return _verdict(
            "suppressed",
            "never_touch",
            f"{service_name} is on the never-touch list, so nothing is proposed for it",
        )

    skill = _matching_skill(skills, action_type, service_name)
    if skill is not None and not skill.get("enabled", True):
        return _verdict(
            "suppressed",
            "skill_disabled",
            f"the skill {skill.get('name') or action_type!r} is switched off",
        )

    if autonomy == "observe":
        return _verdict(
            "suppressed",
            "autonomy_observe",
            "the agent is set to observe, so it records its reasoning and proposes nothing",
        )

    disposition = (risk_policy.get(risk) or "ask_first").strip().lower()

    if disposition == "never":
        return _verdict(
            "suppressed",
            "risk_never",
            f"the policy for {risk} risk is never, so this is not proposed",
        )

    # ---- from here it is proposed; the only question is who decides ------
    if autonomy == "suggest":
        return _verdict(
            "ask_first",
            "autonomy_suggest",
            "the agent is set to suggest, so every action waits for a person",
        )

    wants_auto = disposition == "auto_run" or autonomy == "act_autonomously"

    if not wants_auto:
        return _verdict(
            "ask_first",
            "risk_ask_first",
            f"the policy for {risk} risk is ask first",
        )

    # act_autonomously is the one level that removes the human entirely, and
    # /api/* has no authentication. So it needs a deliberate server-side opt-in,
    # the same shape as change_delivery_push_enabled: the dangerous state is not
    # reachable by anyone who can merely reach the dashboard.
    if autonomy == "act_autonomously" and not settings.agent_autonomy_enabled:
        return _verdict(
            "ask_first",
            "autonomy_not_enabled",
            "acting autonomously is off on this server (AGENT_AUTONOMY_ENABLED), "
            "so this waits for a person",
        )

    # ---- guardrails downgrade, they do not suppress ----------------------
    # The incident is real whether or not it is Saturday. Dropping the proposal
    # would lose the work; making a person decide only defers it.
    if in_blackout_window(
        now,
        guardrails.get("blackout_start_dow"),
        guardrails.get("blackout_start_time"),
        guardrails.get("blackout_end_dow"),
        guardrails.get("blackout_end_time"),
    ):
        return _verdict(
            "ask_first",
            "blackout_window",
            "inside the change blackout window, so nothing runs unattended",
        )

    ceiling = int(guardrails.get("max_concurrent_executions") or 1)
    if running_executions >= ceiling:
        return _verdict(
            "ask_first",
            "at_concurrency_ceiling",
            f"{running_executions} of {ceiling} concurrent executions are already running",
        )

    if autonomy == "act_autonomously":
        return _verdict(
            "auto_run", "autonomy_autonomous", "the agent is set to act autonomously"
        )
    return _verdict(
        "auto_run", "risk_auto_run", f"the policy for {risk} risk is auto-run"
    )


# ---------------------------------------------------------------- loading
# Kept below `decide` and separate from it on purpose: everything above is pure
# and testable without a database, and this is the only part that is not.

DEFAULT_GUARDRAILS: dict[str, Any] = {
    "max_concurrent_executions": 1,
    "blackout_start_dow": None,
    "blackout_start_time": None,
    "blackout_end_dow": None,
    "blackout_end_time": None,
    "never_touch_services": [],
}


async def load_inputs(conn: Any, agent_name: str) -> dict[str, Any]:
    """Everything `decide` needs, for one agent.

    Fails cautious rather than open. A missing agent row, a missing policy row or
    a missing guardrails row all end up as "ask a person", because the one
    outcome worth avoiding is a schema gap that reads as permission.
    """
    from app.queries import agents as q

    agent = await conn.fetchrow(q.AGENT_POLICY, agent_name)
    if agent is None:
        logger.warning("no agents row for %r; treating every action as ask-first", agent_name)
        return {
            "autonomy": "suggest",
            "risk_policy": {},
            "skills": [],
            "guardrails": dict(DEFAULT_GUARDRAILS),
            "running_executions": 0,
        }

    policy_rows = await conn.fetch(q.RISK_POLICY_FOR_AGENT, agent["id"])
    skill_rows = await conn.fetch(q.SKILLS_FOR_AGENT, agent["id"])
    guardrail_row = await conn.fetchrow(q.GUARDRAILS)
    running = await conn.fetchval(q.RUNNING_EXECUTIONS)

    return {
        "autonomy": agent["autonomy"],
        "risk_policy": {r["risk_level"]: r["disposition"] for r in policy_rows},
        "skills": [dict(r) for r in skill_rows],
        "guardrails": dict(guardrail_row) if guardrail_row else dict(DEFAULT_GUARDRAILS),
        "running_executions": int(running or 0),
    }
