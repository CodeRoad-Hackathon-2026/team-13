"""Calls an HTTP endpoint named in an action's parameters.

The riskiest tool in the registry despite looking like the tamest: the URL comes
from a language model's output, so without a host allowlist this is a
request-forgery primitive that a human approves by clicking Approve. The
allowlist defaults to localhost — real targets are an explicit operator decision,
not something an LLM can reach into.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import settings
from app.tools import ToolResult

logger = logging.getLogger(__name__)

METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


class HttpTool:
    name = "http"

    async def run(self, parameters: dict[str, Any]) -> ToolResult:
        endpoint = str(parameters.get("endpoint") or parameters.get("url") or "").strip()
        if not endpoint:
            return ToolResult(ok=False, error="the action carries no endpoint to call")

        host = urlparse(endpoint).hostname or ""
        if host not in settings.execution_allowed_hosts:
            # Refused, not attempted. The operator approved a remediation, not a
            # request to whatever host the planner happened to write down.
            return ToolResult(
                ok=False,
                error=(
                    f"host {host!r} is not in EXECUTION_ALLOWED_HOSTS; "
                    "add it deliberately before this action can run"
                ),
                logs=f"Refused to call {endpoint} — host not allowed.",
            )

        method = str(parameters.get("method") or "POST").upper()
        if method not in METHODS:
            return ToolResult(ok=False, error=f"unsupported method {method!r}")

        payload = parameters.get("payload") if isinstance(parameters.get("payload"), dict) else None

        try:
            async with httpx.AsyncClient(timeout=settings.execution_timeout_seconds) as client:
                response = await client.request(method, endpoint, json=payload)
        except httpx.HTTPError as exc:
            return ToolResult(
                ok=False,
                error=f"{method} {endpoint} failed: {exc}",
                logs=f"{method} {endpoint}\n{exc}",
            )

        body: Any
        try:
            body = response.json()
        except ValueError:
            body = response.text[:2000]

        ok = response.is_success
        return ToolResult(
            ok=ok,
            response={"statusCode": response.status_code, "body": body},
            logs=f"{method} {endpoint} -> {response.status_code}",
            error=None if ok else f"target returned {response.status_code}",
        )
