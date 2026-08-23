"""The Change Delivery Agent, end to end against a local bare repository."""

from pathlib import Path
from typing import Any

import pytest

from app.agents.change_delivery import ChangeDeliveryAgent
from app.config import settings
from tests.conftest import needs_git

CLEAN_DIFF = """--- a/infra/pgbouncer.tf
+++ b/infra/pgbouncer.tf
@@ -1,5 +1,5 @@
 resource "aws_db_proxy" "payments" {
   name = "payments-db-primary"
-  max_connections_percent      = 60
+  max_connections_percent      = 100
   max_idle_connections_percent = 20
 }
"""

# Same edit, but the @@ counts are wrong — exactly what a model writing from a
# runbook produces. Only --recount rescues it.
MISCOUNTED_DIFF = CLEAN_DIFF.replace("@@ -1,5 +1,5 @@", "@@ -1,9 +1,9 @@")

# Context that does not exist in the file at all. No flag can fix this; it is
# what regeneration is for.
WRONG_CONTEXT_DIFF = CLEAN_DIFF.replace('name = "payments-db-primary"', 'name = "something-else"')


class FakeRag:
    def __init__(self, answer: str | None = None, abstain: bool = False) -> None:
        self._answer = answer
        self._abstain = abstain
        self.calls = 0

    async def answer(self, prompt: str, *, incident_id: str, **_: Any) -> dict[str, Any]:
        self.calls += 1
        self.last_prompt = prompt
        if self._abstain:
            return {"abstained": True, "abstain_reason": "no_results"}
        return {"abstained": False, "answer": self._answer or ""}


def incident_row(origin_url: str) -> dict[str, Any]:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "external_id": "PD-1",
        "title": "payments-api pool exhausted",
        "repository_url": origin_url,
    }


@pytest.fixture(autouse=True)
def delivery_settings(tmp_path, monkeypatch, origin):
    slug = origin.removeprefix("file://")
    monkeypatch.setattr(settings, "change_delivery_allowed_repos", [slug])
    monkeypatch.setattr(settings, "change_delivery_workdir", str(tmp_path / "work"))
    monkeypatch.setattr(settings, "change_delivery_push_enabled", True)


async def deliver(origin_url: str, diff: str, rag: FakeRag | None = None):
    agent = ChangeDeliveryAgent(
        {"description": "Raise the pool ceiling"},
        {"diff": diff, "base": "main", "branch": "pool-ceiling"},
        rag or FakeRag(),
    )
    return await agent.handle(None, incident_row(origin_url), "run-abcdef12")


@needs_git
@pytest.mark.asyncio
async def test_a_clean_patch_is_committed_and_pushed(origin, remote_branches):
    result = await deliver(origin, CLEAN_DIFF)

    assert result.output["delivered"] is True
    assert result.output["pushed"] is True
    assert result.output["filesChanged"] == ["infra/pgbouncer.tf"]
    assert "remediate/pool-ceiling" in remote_branches(origin), "the branch never reached the remote"


@needs_git
@pytest.mark.asyncio
async def test_a_miscounted_hunk_is_rescued_by_the_ladder(origin, remote_branches):
    result = await deliver(origin, MISCOUNTED_DIFF)

    assert result.output["delivered"] is True
    attempts = result.output["applyAttempts"]
    assert attempts[0]["ok"] is False, "the strict rung should have refused it"
    assert result.output["regenerations"] == 0, "the ladder should have fixed this without a model"


@needs_git
@pytest.mark.asyncio
async def test_unfixable_context_is_regenerated_against_the_real_file(origin, remote_branches):
    rag = FakeRag(answer=f"Here you go:\n```diff\n{CLEAN_DIFF}```")
    result = await deliver(origin, WRONG_CONTEXT_DIFF, rag)

    assert result.output["delivered"] is True
    assert result.output["regenerations"] == 1
    assert rag.calls == 1
    # The prompt has to carry the real file with line numbers, or the model has
    # nothing to correct its @@ header against.
    assert "max_connections_percent" in rag.last_prompt
    assert "    1|" in rag.last_prompt


@needs_git
@pytest.mark.asyncio
async def test_giving_up_is_a_decline_not_a_fault(origin, remote_branches):
    result = await deliver(origin, WRONG_CONTEXT_DIFF, FakeRag(abstain=True))

    # The agent ran correctly and reached a conclusion. Red belongs on the
    # execution, not on the agent's own run.
    assert result.output["delivered"] is False
    assert "did not apply" in result.output["reason"]
    assert "remediate/pool-ceiling" not in remote_branches(origin)


@needs_git
@pytest.mark.asyncio
async def test_a_regeneration_reaching_a_new_file_is_rejected(origin, remote_branches):
    strayed = CLEAN_DIFF + """--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
-old
+new
"""
    rag = FakeRag(answer=f"```diff\n{strayed}```")
    result = await deliver(origin, WRONG_CONTEXT_DIFF, rag)

    # Whatever its merits, a rewrite touching a file the human never reviewed has
    # drifted from what was approved.
    assert result.output["delivered"] is False


@needs_git
@pytest.mark.asyncio
async def test_push_disabled_commits_without_reaching_the_remote(origin, remote_branches, monkeypatch):
    monkeypatch.setattr(settings, "change_delivery_push_enabled", False)
    result = await deliver(origin, CLEAN_DIFF)

    assert result.output["delivered"] is True
    assert result.output["pushed"] is False and result.output["dryRun"] is True
    assert result.output["compareUrl"] is None
    assert "remediate/pool-ceiling" not in remote_branches(origin)


@needs_git
@pytest.mark.asyncio
async def test_a_repository_outside_the_allowlist_is_refused(origin, monkeypatch):
    monkeypatch.setattr(settings, "change_delivery_allowed_repos", [])
    result = await deliver(origin, CLEAN_DIFF)

    assert result.output["delivered"] is False
    assert "CHANGE_DELIVERY_ALLOWED_REPOS" in result.output["reason"]
