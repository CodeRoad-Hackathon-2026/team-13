"""Turning a model's prose reply into a structure, without guessing.

Shared by the two agents that ask RAG Core for a decision. Both need the same
tolerance — models emit fenced blocks, bare objects, or prose with an object
buried in it — and the same refusal to invent anything when there is no object
to find.
"""

from __future__ import annotations

import json
import re
from typing import Any

_FENCED = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def extract_json_object(answer: str) -> dict[str, Any] | None:
    """Pull a single JSON object out of a reply.

    Returns None when there is none — which is how an agent declines, not an
    error. Anything that is not an object (an array, a scalar) is also None:
    a caller asked for a decision and did not get one.
    """
    fenced = _FENCED.search(answer)
    candidate = fenced.group(1) if fenced else None

    if candidate is None:
        start = answer.find("{")
        end = answer.rfind("}")
        if start == -1 or end <= start:
            return None
        candidate = answer[start : end + 1]

    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None

    return parsed if isinstance(parsed, dict) else None


def one_of(value: Any, allowed: set[str], fallback: str) -> str:
    """Constrain a model's string to a closed set.

    Every enum-backed column here rejects an unknown value at insert time, so a
    hallucinated priority would abort the whole write rather than degrade.
    """
    candidate = str(value or "").strip().upper()
    return candidate if candidate in allowed else fallback
