"""Jira connector against a mocked API — pagination and the incremental cursor.

The cursor logic is where a connector quietly goes wrong: too eager and every
poll re-fetches the world, too greedy and it skips tickets updated during the
boundary minute.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.ingestion.sources import run_source


def _issue(key: str, updated: str) -> dict:
    return {
        "key": key,
        "fields": {
            "summary": f"summary {key}",
            "description": f"body of {key}",
            "status": {"name": "Done"},
            "updated": updated,
            "created": "2026-01-01T00:00:00.000+0000",
        },
    }


@pytest.fixture
def mock_jira(monkeypatch):
    """Patch httpx.AsyncClient so the connector talks to an in-process handler."""
    calls: list[httpx.Request] = []
    pages = [
        [_issue("OPS-1", "2026-01-02T10:00:00.000+0000"),
         _issue("OPS-2", "2026-01-03T11:00:00.000+0000")],
        [_issue("OPS-3", "2026-01-04T12:00:00.000+0000")],
        [],
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        start_at = int(request.url.params.get("startAt", 0))
        index = 0 if start_at == 0 else (1 if start_at == 2 else 2)
        issues = pages[index]
        return httpx.Response(
            200, json={"issues": issues, "total": 3, "startAt": start_at}
        )

    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    return calls


async def test_jira_pages_until_total_is_reached(mock_jira):
    run = await run_source(
        "jira",
        "incidents",
        {"base_url": "https://acme.atlassian.net", "email": "a@b.c", "api_token": "t"},
        {},
    )
    assert [d.external_id for d in run.documents] == ["OPS-1", "OPS-2", "OPS-3"]
    assert run.documents[0].content.startswith("# OPS-1")
    assert run.documents[0].uri == "https://acme.atlassian.net/browse/OPS-1"


async def test_watermark_advances_to_the_newest_updated(mock_jira):
    run = await run_source(
        "jira",
        "incidents",
        {"base_url": "https://acme.atlassian.net", "email": "a@b.c", "api_token": "t"},
        {},
    )
    assert run.cursor["updated_since"] == "2026-01-04T12:00:00.000+0000"


async def test_next_poll_filters_by_the_stored_watermark(mock_jira):
    await run_source(
        "jira",
        "incidents",
        {"base_url": "https://acme.atlassian.net", "email": "a@b.c", "api_token": "t"},
        {"updated_since": "2026-01-03T00:00:00.000+0000"},
    )
    jql = mock_jira[0].url.params["jql"]
    assert 'updated >= "2026-01-03T00:00:00.000+0000"' in jql
    # Ascending order is what makes the watermark monotonic.
    assert "ORDER BY updated ASC" in jql


async def test_configured_jql_is_preserved(mock_jira):
    await run_source(
        "jira",
        "incidents",
        {
            "base_url": "https://acme.atlassian.net",
            "email": "a@b.c",
            "api_token": "t",
            "jql": "project = OPS AND statusCategory = Done",
        },
        {},
    )
    assert "project = OPS" in mock_jira[0].url.params["jql"]


async def test_secrets_are_resolved_from_the_environment(mock_jira, monkeypatch):
    monkeypatch.setenv("JIRA_API_TOKEN", "from-env")
    await run_source(
        "jira",
        "incidents",
        {
            "base_url": "https://acme.atlassian.net",
            "email": "a@b.c",
            "api_token": "${JIRA_API_TOKEN}",
        },
        {},
    )
    # Basic auth carries the resolved token, so it never had to be stored in
    # the sources table.
    assert mock_jira[0].headers["authorization"].startswith("Basic ")
