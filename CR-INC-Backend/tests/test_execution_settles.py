"""An execution must never be left RUNNING.

The cardinal sin of this system: a card polls the execution row, so RUNNING is a
claim that a remediation is still working. If the process that owned it has gone,
that claim is a lie the operator cannot tell from a slow job.

These tests drive the close path with a fake connection and assert that every
failure mode still reaches a terminal status.
"""

from typing import Any

import pytest

from app.agents.execution import SETTLE, ExecutionAgent
from app.tools import ToolResult, UnregisteredTool


class FakeConn:
    """Records SQL instead of running it, and answers the two reads handle() makes."""

    def __init__(self, status: str = "RUNNING") -> None:
        self.executed: list[tuple[str, tuple[Any, ...]]] = []
        self._row = {
            "id": "exec-1",
            "status": status,
            "action_id": "act-1",
            "action_type": "API",
            "parameters": None,
            "description": "restart the pool",
            "incident_id": "inc-1",
        }

    async def fetchrow(self, *_args: Any) -> dict[str, Any] | None:
        return self._row

    async def execute(self, sql: str, *args: Any) -> str:
        self.executed.append((sql, args))
        return "UPDATE 1"

    def finished_status(self) -> str | None:
        """The status the FINISH statement was called with, if it was called."""
        for sql, args in self.executed:
            if "UPDATE executed_actions" in sql and "finished_at = now()" in sql and len(args) > 2:
                return args[1]
        return None


def agent_with(tool_behaviour) -> tuple[ExecutionAgent, FakeConn]:
    agent = ExecutionAgent("exec-1")
    conn = FakeConn()

    import app.agents.execution as module

    module.tool_for = tool_behaviour  # type: ignore[assignment]
    return agent, conn


@pytest.fixture(autouse=True)
def restore_tool_for():
    import app.agents.execution as module

    original = module.tool_for
    yield
    module.tool_for = original


class RaisingTool:
    name = "raising"

    async def run(self, parameters: dict[str, Any]) -> ToolResult:
        raise RuntimeError("the remote hung up")


class OkTool:
    name = "ok"

    async def run(self, parameters: dict[str, Any]) -> ToolResult:
        return ToolResult(ok=True, response={"statusCode": 200})


@pytest.mark.parametrize(
    "behaviour,expected",
    [
        # A tool that raises is the case a git-driven executor will actually hit.
        (lambda _t: RaisingTool(), "FAILED"),
        # Resolving the executor itself blowing up.
        (lambda _t: (_ for _ in ()).throw(ValueError("registry is broken")), "FAILED"),
        # The already-handled case, kept so a refactor cannot regress it.
        (lambda _t: (_ for _ in ()).throw(UnregisteredTool("GITHUB_PR")), "FAILED"),
        (lambda _t: OkTool(), "SUCCESS"),
    ],
)
@pytest.mark.asyncio
async def test_every_outcome_reaches_a_terminal_status(behaviour, expected):
    agent, conn = agent_with(behaviour)

    result = await agent.handle(conn, {"id": "inc-1"}, "run-1")

    assert conn.finished_status() == expected, "the execution row was never closed"
    assert result.output["executed"] is True


@pytest.mark.asyncio
async def test_a_raising_tool_does_not_escape_handle():
    # If it escaped, Agent.execute would close the agent run and roll back the
    # transaction — taking the RUNNING row with it and leaving nothing to settle.
    agent, conn = agent_with(lambda _t: RaisingTool())
    result = await agent.handle(conn, {"id": "inc-1"}, "run-1")
    assert "the remote hung up" in (result.output["error"] or "")


@pytest.mark.asyncio
async def test_an_already_settled_execution_is_left_alone():
    agent = ExecutionAgent("exec-1")
    conn = FakeConn(status="SUCCESS")
    result = await agent.handle(conn, {"id": "inc-1"}, "run-1")

    assert result.output == {"executed": False, "reason": "already SUCCESS"}
    assert conn.executed == [], "a settled execution must not be rewritten"


def test_settle_only_touches_running_rows():
    # Compare-and-set is what makes settling safe to call unconditionally, and
    # safe to call twice.
    assert "status = 'RUNNING'" in SETTLE
    assert "WHERE id = $1" in SETTLE
