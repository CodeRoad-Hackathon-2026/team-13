"""Connector logic that does not need vendor credentials."""

from __future__ import annotations

import pytest

from app.ingestion.sources import (
    MissingSecret,
    adf_to_text,
    html_to_text,
    matches,
    parse_dt,
    pluck,
    resolve_secrets,
)
from app.ingestion.sources.aws_logs import fingerprint
from app.ingestion.sources.jira import _render_issue


# ------------------------------------------------------------------ secrets
def test_env_placeholders_are_resolved(monkeypatch):
    monkeypatch.setenv("JIRA_TOKEN", "s3cret")
    config = {"api_token": "${JIRA_TOKEN}", "nested": {"list": ["${JIRA_TOKEN}"]}}
    assert resolve_secrets(config) == {
        "api_token": "s3cret",
        "nested": {"list": ["s3cret"]},
    }


def test_missing_secret_fails_loudly(monkeypatch):
    monkeypatch.delenv("NOT_SET_ANYWHERE", raising=False)
    # A silently-empty token surfaces as a confusing 401 deep inside a vendor
    # client; fail at the top of the run instead.
    with pytest.raises(MissingSecret):
        resolve_secrets({"token": "${NOT_SET_ANYWHERE}"})


# -------------------------------------------------------------------- globs
def test_recursive_glob_matches_root_level_files():
    # fnmatch has no `**` concept: without the shim, `**/*.md` skips every file
    # at the root and the source indexes nothing.
    assert matches("redis.md", ["**/*.md"])
    assert matches("docs/deep/redis.md", ["**/*.md"])
    assert not matches("redis.txt", ["**/*.md"])


# ---------------------------------------------------------------- aws logs
def test_fingerprint_collapses_variable_parts():
    a = fingerprint("2026-01-02T03:04:05Z ERROR conn 10.0.0.5:5432 timeout after 30ms")
    b = fingerprint("2026-03-09T11:22:33Z ERROR conn 10.0.9.9:5432 timeout after 90ms")
    assert a == b, "same failure mode must collapse to one pattern"


def test_fingerprint_keeps_distinct_failures_apart():
    a = fingerprint("ERROR connection refused")
    b = fingerprint("ERROR permission denied")
    assert a != b


def test_fingerprint_normalizes_uuids_and_paths():
    shape = fingerprint(
        "req 550e8400-e29b-41d4-a716-446655440000 failed at /var/log/app/run.log"
    )
    assert "<UUID>" in shape and "<PATH>" in shape


# -------------------------------------------------------------------- jira
def test_adf_and_plain_descriptions_both_render():
    adf = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Pool saturated."}]}
        ],
    }
    assert "Pool saturated." in adf_to_text(adf)
    assert adf_to_text("plain v2 string") == "plain v2 string"


def test_jira_issue_renders_comments_and_facets():
    issue = {
        "key": "OPS-42",
        "fields": {
            "summary": "Checkout 5xx spike",
            "description": "Errors after deploy.",
            "status": {"name": "Done"},
            "resolution": {"name": "Fixed"},
            "priority": {"name": "P1"},
            "components": [{"name": "payments"}],
            "labels": ["incident"],
            "project": {"key": "OPS"},
            "issuetype": {"name": "Incident"},
            "comment": {
                "comments": [
                    {
                        "author": {"displayName": "Ana"},
                        "created": "2026-01-02T00:00:00.000+0000",
                        "body": "pgbouncer was the bottleneck",
                    }
                ]
            },
        },
    }
    content, metadata = _render_issue(issue, {})
    # The fix usually lives in the comments, not the description.
    assert "pgbouncer was the bottleneck" in content
    assert "Errors after deploy." in content
    assert metadata["resolution"] == "Fixed"
    assert metadata["priority"] == "P1"
    assert metadata["components"] == ["payments"]


def test_jira_custom_fields_become_filterable_metadata():
    issue = {
        "key": "OPS-1",
        "fields": {"summary": "x", "customfield_10032": {"value": "SEV1"}},
    }
    _, metadata = _render_issue(issue, {"custom_fields": {"severity": "customfield_10032"}})
    assert metadata["severity"] == "SEV1"


# -------------------------------------------------------------- confluence
def test_html_is_reduced_to_readable_text():
    text = html_to_text(
        "<h1>Runbook</h1><p>Scale <b>pgbouncer</b> first.</p><script>evil()</script>"
    )
    assert "Scale" in text and "pgbouncer" in text
    assert "evil()" not in text, "script bodies must not reach the index"


# ------------------------------------------------------------------ common
def test_dotted_paths_and_timestamps():
    assert pluck({"fields": {"summary": "hi"}}, "fields.summary") == "hi"
    assert pluck({"a": 1}, "a.b.c") is None
    assert parse_dt("2026-01-02T03:04:05Z").year == 2026
    # Slack sends float epoch seconds, CloudWatch epoch milliseconds.
    assert parse_dt(1767322445.0).year == 2026
    assert parse_dt(1767322445000).year == 2026
