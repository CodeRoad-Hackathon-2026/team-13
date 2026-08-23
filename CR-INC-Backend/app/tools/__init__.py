"""The registry of things an approved action can actually do.

An action_type is a promise that something can carry it out. Nothing here is
registered implicitly: a type with no tool fails with that stated, rather than
appearing to run and silently doing nothing — which is what an execution stuck
in RUNNING forever amounts to.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ToolResult:
    ok: bool
    # Goes to executed_actions.response_payload — what the target said.
    response: dict[str, Any] = field(default_factory=dict)
    # Goes to executed_actions.execution_logs — what we did, for a human.
    logs: str = ""
    error: str | None = None


class Tool(Protocol):
    name: str

    async def run(self, parameters: dict[str, Any]) -> ToolResult: ...


class UnregisteredTool(LookupError):
    def __init__(self, action_type: str) -> None:
        super().__init__(f"no executor is registered for {action_type}")
        self.action_type = action_type


def registry() -> dict[str, Tool]:
    """action_type -> tool.

    Built on call rather than at import so the HTTP client is created inside a
    running event loop.
    """
    from app.tools.http import HttpTool

    http = HttpTool()
    return {"API": http, "WEBHOOK": http}


def tool_for(action_type: str) -> Tool:
    tools = registry()
    tool = tools.get(action_type.upper())
    if tool is None:
        raise UnregisteredTool(action_type)
    return tool
