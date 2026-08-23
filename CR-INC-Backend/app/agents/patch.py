"""Parses a unified diff into something a UI can render line by line.

The planner is asked for a unified diff rather than for a JSON tree of hunks:
models produce diffs reliably because the format is everywhere in their training
data, and a malformed one is detectable here instead of arriving as plausible
nonsense in a structure we invented.

Line numbers are reconstructed from the hunk headers, so the viewer can show the
real numbers from the file rather than counting from one.
"""

from __future__ import annotations

import re
from typing import Any

DIFF_FENCE = re.compile(r"```(?:diff|patch)?\s*\n(.*?)```", re.DOTALL)
DIFF_START = re.compile(r"^(diff --git |--- )", re.MULTILINE)

HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")
OLD_FILE = re.compile(r"^--- (?:a/)?(.+?)(?:\t.*)?$")
NEW_FILE = re.compile(r"^\+\+\+ (?:b/)?(.+?)(?:\t.*)?$")


def parse_unified_diff(diff: str) -> dict[str, Any]:
    """Turn a unified diff into files, hunks and numbered lines.

    Returns empty files when there is nothing parseable — the caller treats that
    as "the planner did not produce a change", not as a zero-line change.
    """
    files: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    hunk: dict[str, Any] | None = None
    old_no = new_no = 0

    for raw in (diff or "").splitlines():
        if raw.startswith("diff --git"):
            current = hunk = None
            continue

        matched = OLD_FILE.match(raw)
        if matched and not raw.startswith("---" + " " * 10):
            # Held until the +++ line: a rename shows both, and the new path is
            # the one the reviewer cares about.
            current = {"path": matched.group(1), "hunks": [], "additions": 0, "deletions": 0}
            hunk = None
            continue

        matched = NEW_FILE.match(raw)
        if matched:
            if current is None:
                current = {"path": matched.group(1), "hunks": [], "additions": 0, "deletions": 0}
            else:
                current["path"] = matched.group(1)
            files.append(current)
            hunk = None
            continue

        matched = HUNK.match(raw)
        if matched and current is not None:
            old_no, new_no = int(matched.group(1)), int(matched.group(3))
            hunk = {"header": (matched.group(5) or "").strip(), "lines": []}
            current["hunks"].append(hunk)
            continue

        if hunk is None or current is None:
            continue

        if raw.startswith("\\"):
            # "\ No newline at end of file" — metadata, not a line of the file.
            continue

        if raw.startswith("+"):
            hunk["lines"].append({"kind": "add", "old": None, "new": new_no, "text": raw[1:]})
            current["additions"] += 1
            new_no += 1
        elif raw.startswith("-"):
            hunk["lines"].append({"kind": "del", "old": old_no, "new": None, "text": raw[1:]})
            current["deletions"] += 1
            old_no += 1
        else:
            text = raw[1:] if raw.startswith(" ") else raw
            hunk["lines"].append({"kind": "context", "old": old_no, "new": new_no, "text": text})
            old_no += 1
            new_no += 1

    return {
        "files": files,
        "additions": sum(f["additions"] for f in files),
        "deletions": sum(f["deletions"] for f in files),
    }


def extract_diff_block(answer: str) -> str | None:
    """Pull a unified diff out of a model's reply.

    The counterpart to `extract_json_object` for the other thing a model is asked
    to produce here. Returns None when there is no diff to find — which is how a
    regeneration declines, not an error.
    """
    if not answer:
        return None

    fenced = DIFF_FENCE.search(answer)
    if fenced:
        candidate = fenced.group(1)
        return candidate if DIFF_START.search(candidate) else None

    # Unfenced: take everything from where the diff starts. Prose before it is
    # common; prose after it would corrupt the patch, but git tolerates trailing
    # junk far better than a truncated hunk.
    match = DIFF_START.search(answer)
    return answer[match.start():] if match else None
