"""Normalising and applying a model-authored diff."""

import pytest

from app.agents.diff_apply import (
    apply_with_ladder,
    normalise,
    strip_level,
    touched_paths,
)
from app.agents.patch import extract_diff_block

DIFF = """--- a/infra/pgbouncer.tf
+++ b/infra/pgbouncer.tf
@@ -41,3 +41,3 @@
 resource "x" {
-  max = 60
+  max = 100
"""


class TestNormalise:
    def test_strips_a_fenced_block(self):
        assert normalise(f"Here:\n```diff\n{DIFF}```\nDone.").startswith("--- a/infra")

    def test_converts_crlf(self):
        assert "\r" not in normalise(DIFF.replace("\n", "\r\n"))

    def test_guarantees_a_trailing_newline(self):
        # git reports a missing final newline as "corrupt patch at line N",
        # which sends you looking in entirely the wrong place.
        assert normalise(DIFF.rstrip("\n")).endswith("\n")

    def test_empty_stays_empty(self):
        assert normalise("") == ""


class TestStripLevel:
    def test_p1_for_the_usual_prefixes(self):
        assert strip_level(DIFF) == "-p1"

    def test_p0_when_paths_are_bare(self):
        assert strip_level(DIFF.replace("a/", "").replace("b/", "")) == "-p0"


class FakeGit:
    """Records the flags each rung was tried with, and fails the first N rungs."""

    def __init__(self, fail_checks: int = 0) -> None:
        self.fail_checks = fail_checks
        self.calls: list[list[str]] = []

    async def __call__(self, args: list[str]) -> tuple[bool, str]:
        self.calls.append(args)
        if "--check" in args:
            index = sum(1 for c in self.calls if "--check" in c)
            if index <= self.fail_checks:
                return False, "error: patch failed: infra/pgbouncer.tf:41"
            return True, ""
        return True, ""


class TestLadder:
    @pytest.mark.asyncio
    async def test_a_clean_patch_applies_on_the_first_rung(self):
        git = FakeGit()
        outcome = await apply_with_ladder(DIFF, git)
        assert outcome.applied and outcome.flags == []
        assert len(outcome.attempts) == 1

    @pytest.mark.asyncio
    async def test_falls_through_to_recount(self):
        # The model hand-writes the @@ counts and gets them wrong often enough
        # that this is the rung that earns its keep.
        git = FakeGit(fail_checks=1)
        outcome = await apply_with_ladder(DIFF, git)
        assert outcome.applied and outcome.flags == ["--recount"]
        assert outcome.attempts[0].ok is False

    @pytest.mark.asyncio
    async def test_nothing_is_applied_until_a_check_passes(self):
        git = FakeGit(fail_checks=2)
        await apply_with_ladder(DIFF, git)
        applied = [c for c in git.calls if "--check" not in c]
        assert len(applied) == 1, "a failed rung must not touch the working tree"

    @pytest.mark.asyncio
    async def test_gives_up_and_keeps_gits_first_error(self):
        outcome = await apply_with_ladder(DIFF, FakeGit(fail_checks=99))
        assert outcome.applied is False
        assert "patch failed" in outcome.first_error

    @pytest.mark.asyncio
    async def test_three_way_is_recorded_as_skipped_when_there_is_no_index_line(self):
        # -3 needs the pre-image blob, found via `index <sha>..<sha>`. Without it
        # git silently does an ordinary apply — so claiming it was tried would be
        # a lie in the attempt list.
        outcome = await apply_with_ladder(DIFF, FakeGit(fail_checks=99))
        last = outcome.attempts[-1]
        assert last.flags == ["--3way"] and "no index line" in last.note

    @pytest.mark.asyncio
    async def test_three_way_is_a_real_rung_when_the_patch_came_from_git(self):
        with_index = DIFF.replace("--- a/", "index 1234567..89abcde 100644\n--- a/", 1)
        git = FakeGit(fail_checks=4)
        outcome = await apply_with_ladder(with_index, git)
        assert outcome.applied and outcome.flags == ["--3way"]

    @pytest.mark.asyncio
    async def test_a_patch_describing_no_files_fails_before_git_is_called(self):
        git = FakeGit()
        outcome = await apply_with_ladder("not a diff at all", git)
        assert outcome.applied is False and git.calls == []


class TestExtractDiffBlock:
    def test_reads_a_fenced_diff(self):
        assert extract_diff_block(f"Sure:\n```diff\n{DIFF}```").startswith("--- a/")

    def test_reads_an_unfenced_diff_after_prose(self):
        assert extract_diff_block(f"Here is the patch.\n{DIFF}").startswith("--- a/")

    def test_prose_alone_is_none(self):
        assert extract_diff_block("I cannot produce a patch for that file.") is None

    def test_a_fence_holding_something_else_is_none(self):
        assert extract_diff_block('```json\n{"a": 1}\n```') is None


def test_touched_paths_names_the_files():
    assert touched_paths(DIFF) == ["infra/pgbouncer.tf"]
