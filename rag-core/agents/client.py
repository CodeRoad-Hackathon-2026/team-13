"""Plain HTTP client for the RAG API.

Kept separate from ``tools.py`` because that module imports CrewAI at import
time. Everything here works with `httpx` alone, which is what lets the
justification builder and the dry run be exercised without installing the
crew's dependency tree.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

def _normalize(url: str) -> str:
    """Add the scheme when it is missing.

    `RAG_API_URL=localhost:8000/v1` is the obvious thing to type and httpx
    rejects it with `unsupported protocol 'localhost://'`, which reads like a
    library bug rather than a missing `http://`.
    """
    url = url.strip().rstrip("/")
    return url if "://" in url else f"http://{url}"


API_URL = _normalize(os.environ.get("RAG_API_URL", "http://localhost:8000/v1"))
API_KEY = os.environ.get("RAG_API_KEY", "")
TIMEOUT = float(os.environ.get("RAG_TOOL_TIMEOUT", "120"))


def call(method: str, path: str, payload: dict | None = None) -> dict | list:
    with httpx.Client(
        base_url=API_URL,
        headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
        timeout=TIMEOUT,
    ) as client:
        response = client.request(method, path, json=payload)
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", response.text)
            except Exception:  # noqa: BLE001
                detail = response.text
            raise RuntimeError(f"{method} {path} -> {response.status_code}: {detail}")
        return response.json()


def dumps(value: Any) -> str:
    return json.dumps(value, indent=2, default=str)
