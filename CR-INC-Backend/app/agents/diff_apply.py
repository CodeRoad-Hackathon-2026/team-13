"""Getting a model-authored diff to apply to real code.

A diff written from a runbook is a guess about a file the model never read. It
fails in a small number of recognisable ways, and most of them git can absorb if
asked with the right flags. This is that ladder, plus the normalisation that has
to happen before git sees the patch at all.

Written over an injected runner so the ordering can be tested without git.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.agents.patch import parse_unified_diff

logger = logging.getLogger(__name__)

FENCE = re.compile(r"```(?:diff|patch)?\s*\n(.*?)```", re.DOTALL)
HAS_INDEX_LINE = re.compile(r"^index [0-9a-f]{7,}\.\.[0-9a-f]{7,}", re.MULTILINE)

# Increasing tolerance. Each rung is tried with --check first, so nothing touches
# the working tree until one of them says the patch will apply.
#
#   --recount            the model hand-wrote the @@ counts and often miscounts
#   --ignore-whitespace  it normalised indentation it could not see
#   -C1                  fewer context lines have to match
#
# Deliberately absent: `patch --fuzz` and zero-context matching. Both land an
# edit on a line that merely resembles the target, which is a wrong change with a
# green execution row — worse than a clean failure.
LADDER: tuple[tuple[str, ...], ...] = (
    (),
    ("--recount",),
    ("--recount", "--ignore-whitespace"),
    ("--recount", "--ignore-whitespace", "-C1"),
)


@dataclass
class ApplyAttempt:
    attempt: int
    flags: list[str]
    ok: bool
    error: str | None = None
    note: str | None = None


@dataclass
class ApplyOutcome:
    applied: bool
    attempts: list[ApplyAttempt] = field(default_factory=list)
    flags: list[str] | None = None
    # git's own words from the strictest rung — the most useful thing to hand a
    # model when asking it to try again.
    first_error: str | None = None


def normalise(diff: str) -> str:
    """Make a model's reply into something git will read.

    Every one of these has been seen in the wild: a fenced block, CRLF from a
    JSON round-trip, and a missing final newline, which git reports as the
    thoroughly unhelpful "corrupt patch at line N".
    """
    text = diff or ""
    fenced = FENCE.search(text)
    if fenced:
        text = fenced.group(1)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.strip("\n")
    return text + "\n" if text else ""


def strip_level(diff: str) -> str:
    """`-p1` when paths carry the usual a/ b/ prefixes, `-p0` when they do not."""
    for line in diff.splitlines():
        if line.startswith("--- "):
            return "-p1" if line[4:].startswith(("a/", "b/")) else "-p0"
    return "-p1"


def touched_paths(diff: str) -> list[str]:
    return [f["path"] for f in parse_unified_diff(diff)["files"]]


Runner = Callable[[list[str]], Awaitable[tuple[bool, str]]]


async def apply_with_ladder(diff: str, run: Runner) -> ApplyOutcome:
    """Try progressively more tolerant flags until one applies, or give up.

    `run` receives the flag list and returns (ok, stderr). It is called twice per
    successful rung — once to check, once to apply — which is what keeps a failed
    rung from leaving half a patch on disk.
    """
    outcome = ApplyOutcome(applied=False)
    normalised = normalise(diff)
    if not parse_unified_diff(normalised)["files"]:
        outcome.attempts.append(
            ApplyAttempt(1, [], ok=False, error="the patch describes no files")
        )
        outcome.first_error = "the patch describes no files"
        return outcome

    level = strip_level(normalised)
    rungs = list(LADDER)

    # Three-way apply needs the pre-image blob, which it finds through the
    # `index <sha>..<sha>` line. A model-authored diff has none, so -3 silently
    # degrades to an ordinary apply. Offering it only when the patch really came
    # from `git diff` keeps the attempt list honest.
    if HAS_INDEX_LINE.search(normalised):
        rungs.append(("--3way",))

    for index, flags in enumerate(rungs, start=1):
        args = [level, *flags]
        ok, stderr = await run(["--check", *args])
        if not ok:
            outcome.attempts.append(ApplyAttempt(index, list(flags), ok=False, error=stderr.strip()))
            if outcome.first_error is None:
                outcome.first_error = stderr.strip()
            continue

        ok, stderr = await run([*args, "--whitespace=fix"])
        outcome.attempts.append(
            ApplyAttempt(index, list(flags), ok=ok, error=None if ok else stderr.strip())
        )
        if ok:
            outcome.applied = True
            outcome.flags = list(flags)
            return outcome

    if not HAS_INDEX_LINE.search(normalised):
        outcome.attempts.append(
            ApplyAttempt(
                len(rungs) + 1, ["--3way"], ok=False,
                note="skipped: the patch carries no index line, so 3-way has no blob to work from",
            )
        )
    return outcome


def summarise(outcome: ApplyOutcome) -> list[dict[str, Any]]:
    return [
        {k: v for k, v in vars(attempt).items() if v is not None or k in ("ok", "error")}
        for attempt in outcome.attempts
    ]
