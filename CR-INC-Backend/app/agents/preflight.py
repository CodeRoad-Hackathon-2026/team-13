"""What would happen if a person pressed Approve.

Every guard here already runs — inside HttpTool, inside repo_target, inside the
tool registry — but only at execution time, after the approval. So an operator
approves a KUBERNETES action that has no executor and learns a second later that
nothing was attempted, or approves a code change and finds out from the failure
message that the repository was never on the allowlist. The information existed;
it was just downstream of the decision it should inform.

This reports the same guards *before* the decision, by calling them rather than
restating them. Restating would drift: a guard tightened in one place and
described in another is worse than no description at all.

Nothing here has side effects and nothing here reaches the network. A check that
could fail differently at execution time says so rather than promising.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from app.agents.repo_target import TargetRefused, check_allowed, resolve_repo
from app.config import settings
from app.tools import registry
from app.tools.http import METHODS

logger = logging.getLogger(__name__)

Status = Literal["pass", "warn", "fail"]

# The one action type that is not a registered tool: delivery needs a database
# connection and an incident, which the Tool protocol does not carry, so it is a
# sub-agent dispatched by name in ExecutionAgent.handle.
DELIVERY_TYPE = "GITHUB_PR"


def _check(key: str, label: str, status: Status, detail: str) -> dict[str, Any]:
    return {"key": key, "label": label, "status": status, "detail": detail}


def _executor_check(action_type: str) -> dict[str, Any]:
    """Is there anything at all that can carry this out?

    First because it is the cheapest thing to get wrong and the most expensive to
    discover late: an unregistered type fails the moment it is approved, having
    done nothing, and the operator has spent their approval on it.
    """
    if action_type == DELIVERY_TYPE:
        return _check(
            "executor", "Executor registered", "pass", "Change Delivery Agent"
        )

    tools = registry()
    if action_type in tools:
        return _check(
            "executor", "Executor registered", "pass", f"{tools[action_type].name} tool"
        )

    return _check(
        "executor",
        "Executor registered",
        "fail",
        f"no executor is registered for {action_type} — approving this would fail immediately "
        "without attempting anything",
    )


def _http_checks(parameters: dict[str, Any]) -> list[dict[str, Any]]:
    """The guards HttpTool applies, in the order it applies them."""
    checks: list[dict[str, Any]] = []

    endpoint = str(parameters.get("endpoint") or parameters.get("url") or "").strip()
    if not endpoint:
        checks.append(
            _check("target", "Endpoint present", "fail", "the action carries no endpoint to call")
        )
        return checks

    host = urlparse(endpoint).hostname or ""
    checks.append(_check("target", "Endpoint present", "pass", endpoint))

    # The allowlist itself is never returned — only whether this host is on it.
    # It is server configuration, and the browser has no use for the whole of it.
    if host and host in settings.execution_allowed_hosts:
        checks.append(_check("allowlist", "Host allowed", "pass", host))
    else:
        checks.append(
            _check(
                "allowlist",
                "Host allowed",
                "fail",
                f"{host or 'the endpoint'} is not in EXECUTION_ALLOWED_HOSTS — the call would be "
                "refused, not attempted",
            )
        )

    method = str(parameters.get("method") or "POST").upper()
    if method in METHODS:
        checks.append(_check("method", "Method supported", "pass", method))
    else:
        checks.append(_check("method", "Method supported", "fail", f"unsupported method {method}"))

    return checks


def _delivery_checks(
    parameters: dict[str, Any], repository_url: str | None
) -> list[dict[str, Any]]:
    """The guards the Change Delivery Agent applies before it clones anything."""
    checks: list[dict[str, Any]] = []

    try:
        host, slug, _source = resolve_repo(repository_url, parameters.get("repo"))
    except TargetRefused as exc:
        checks.append(_check("target", "Repository resolved", "fail", str(exc)))
        return checks

    checks.append(_check("target", "Repository resolved", "pass", slug))

    try:
        check_allowed(host, slug)
        checks.append(_check("allowlist", "Repository allowed", "pass", slug))
    except TargetRefused as exc:
        checks.append(_check("allowlist", "Repository allowed", "fail", str(exc)))

    # Not a failure — the documented default, and the operator needs to know which
    # of the two it is before approving. "Approve" means something different in
    # each case, and nothing in the card says which today.
    if settings.change_delivery_push_enabled:
        checks.append(
            _check(
                "push",
                "Push enabled",
                "warn",
                "the branch will be pushed to the remote for real",
            )
        )
    else:
        checks.append(
            _check(
                "push",
                "Push enabled",
                "pass",
                "dry run — the change is cloned, applied and committed, then stopped before push",
            )
        )

    # Only consulted when a push would actually happen: a missing key in dry run
    # is not a finding, and reporting it as one trains the operator to ignore this
    # panel.
    if settings.change_delivery_push_enabled:
        key = Path(settings.change_delivery_ssh_key_path)
        if key.is_file():
            checks.append(_check("credential", "Deploy key present", "pass", "mounted"))
        else:
            checks.append(
                _check(
                    "credential",
                    "Deploy key present",
                    "fail",
                    "push is enabled but no deploy key is mounted — the push would fail",
                )
            )

    return checks


def _state_check(status: str, approved_by: str | None) -> dict[str, Any] | None:
    """Only reported when it is not the ordinary case.

    A PROPOSED action awaiting a decision is the whole point of the card, so
    saying "not yet approved" on every one of them is noise.
    """
    if status == "PROPOSED":
        return None
    if status == "EXECUTED":
        return _check(
            "state",
            "Not already run",
            "fail",
            "this action has already been executed — approving again would do nothing",
        )
    if status == "REJECTED":
        return _check("state", "Not already rejected", "fail", "this action was rejected")
    if status == "APPROVED":
        return _check(
            "state",
            "Not already approved",
            "warn",
            f"already approved by {approved_by or 'someone'} and waiting to run",
        )
    return None


def preflight(
    action_type: str,
    parameters: dict[str, Any],
    status: str,
    approved_by: str | None,
    repository_url: str | None,
) -> dict[str, Any]:
    """The checks, plus the one-word answer to "so what happens if I approve?"."""
    checks: list[dict[str, Any]] = []

    state = _state_check(status, approved_by)
    if state is not None:
        checks.append(state)

    executor = _executor_check(action_type)
    checks.append(executor)

    # Only worth checking the target if something could carry it out at all.
    if executor["status"] == "pass":
        if action_type == DELIVERY_TYPE:
            checks.extend(_delivery_checks(parameters, repository_url))
        elif action_type in registry():
            checks.extend(_http_checks(parameters))

    blocked = [c for c in checks if c["status"] == "fail"]
    dry_run = any(
        c["key"] == "push" and c["status"] == "pass" for c in checks
    ) and action_type == DELIVERY_TYPE

    if blocked:
        verdict = "blocked"
        summary = (
            f"{len(blocked)} check{'s' if len(blocked) > 1 else ''} would stop this before "
            "anything happened."
        )
    elif dry_run:
        verdict = "dry_run"
        summary = "This would run as a dry run — committed locally, nothing pushed."
    else:
        verdict = "will_run"
        summary = "This would run."

    return {"verdict": verdict, "summary": summary, "checks": checks}
