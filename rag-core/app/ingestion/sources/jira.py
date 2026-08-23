"""Jira connector — resolved incidents and their comment threads.

Resolved tickets are the highest-signal corpus for incident response: they pair
a symptom with what actually fixed it. The comments usually matter more than
the description, so they are indexed as part of the same document rather than
dropped.
"""

from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.ingestion.pipeline import DocumentInput
from app.ingestion.sources import (
    CheckResult,
    Field,
    SourceRun,
    adf_to_text,
    check,
    parse_dt,
    register,
)

logger = logging.getLogger(__name__)

# Jira orders by `updated` and we page until exhausted; the watermark makes the
# next poll cheap.
_DEFAULT_JQL = "ORDER BY updated ASC"


def _auth(config: dict) -> httpx.Auth | None:
    """Cloud uses email + API token (basic); Server/DC uses a bearer PAT."""
    if config.get("email") and config.get("api_token"):
        return httpx.BasicAuth(config["email"], config["api_token"])
    return None


def _render_issue(issue: dict, config: dict) -> tuple[str, dict]:
    fields = issue.get("fields") or {}
    summary = fields.get("summary") or ""
    description = adf_to_text(fields.get("description")).strip()

    status = (fields.get("status") or {}).get("name")
    resolution = (fields.get("resolution") or {}).get("name")
    priority = (fields.get("priority") or {}).get("name")
    components = [c.get("name") for c in (fields.get("components") or []) if c.get("name")]
    labels = fields.get("labels") or []

    lines = [f"# {issue.get('key')} — {summary}", ""]
    facts = [
        f"**Status:** {status}" if status else None,
        f"**Resolution:** {resolution}" if resolution else None,
        f"**Priority:** {priority}" if priority else None,
        f"**Components:** {', '.join(components)}" if components else None,
        f"**Labels:** {', '.join(labels)}" if labels else None,
    ]
    facts = [f for f in facts if f]
    if facts:
        lines += ["  ".join(facts), ""]
    if description:
        lines += ["## Description", "", description, ""]

    comments = ((fields.get("comment") or {}).get("comments")) or []
    if comments:
        lines += ["## Comments", ""]
        for comment in comments[: config.get("max_comments", 50)]:
            author = ((comment.get("author") or {}).get("displayName")) or "unknown"
            body = adf_to_text(comment.get("body")).strip()
            if body:
                lines += [f"**{author}** ({comment.get('created', '')[:10]}):", body, ""]

    metadata = {
        "kind": "incident",
        "issue_key": issue.get("key"),
        "status": status,
        "resolution": resolution,
        "priority": priority,
        "project": (fields.get("project") or {}).get("key"),
        "issue_type": (fields.get("issuetype") or {}).get("name"),
    }
    if components:
        metadata["components"] = components
    if labels:
        metadata["labels"] = labels
    # Jira's severity/service fields are per-instance customfield_NNNNN ids.
    for key, field_id in (config.get("custom_fields") or {}).items():
        value = fields.get(field_id)
        if isinstance(value, dict):
            value = value.get("value") or value.get("name")
        if value is not None:
            metadata[key] = value

    return "\n".join(lines).strip(), {k: v for k, v in metadata.items() if v is not None}


@check("jira")
async def check_jira(config: dict) -> CheckResult:
    """`/myself` proves auth; a 1-result JQL search proves the query is valid.

    Both matter: credentials that work against a JQL nobody can parse produce an
    empty source that looks healthy.
    """
    base_url = config["base_url"].rstrip("/")
    headers = {"Accept": "application/json"}
    if config.get("bearer_token"):
        headers["Authorization"] = f"Bearer {config['bearer_token']}"
    async with httpx.AsyncClient(
        base_url=base_url, headers=headers, auth=_auth(config), timeout=20.0
    ) as client:
        me = await client.get("/rest/api/3/myself")
        if me.status_code in (401, 403):
            return CheckResult(False, f"authentication rejected ({me.status_code})")
        me.raise_for_status()
        who = me.json().get("displayName") or me.json().get("emailAddress")

        jql = config.get("jql") or _DEFAULT_JQL
        probe = await client.get(
            "/rest/api/3/search", params={"jql": jql, "maxResults": 1, "fields": "key"}
        )
        if probe.status_code == 400:
            return CheckResult(
                False, f"authenticated as {who}, but the JQL was rejected: {probe.text[:300]}"
            )
        probe.raise_for_status()
        total = probe.json().get("total", 0)

    if total == 0:
        return CheckResult(
            True, f"authenticated as {who}, but the JQL currently matches 0 issues"
        )
    return CheckResult(True, f"authenticated as {who}; JQL matches {total} issues", {"total": total})


@register(
    "jira",
    label="Jira",
    description=(
        "Indexes issues with their comments, because the resolution normally "
        "lives in the comment thread rather than in the description."
    ),
    docs="docs/sources.md#jira",
    fields=(
        Field(
            "base_url",
            "Base URL",
            required=True,
            placeholder="https://acme.atlassian.net",
            help="No /rest suffix — the connector appends the API path.",
        ),
        Field(
            "email",
            "Account email",
            help="Jira Cloud: email + API token. Server/DC: leave blank and use a bearer token.",
        ),
        Field("api_token", "API token", type="secret", placeholder="${JIRA_API_TOKEN}"),
        Field(
            "bearer_token",
            "Bearer token (Server/DC)",
            type="secret",
            placeholder="${JIRA_PAT}",
            help="Alternative to email + API token. Use one pair or the other.",
        ),
        Field(
            "jql",
            "JQL filter",
            type="textarea",
            placeholder='project = OPS AND statusCategory = Done',
            help=(
                "Do not add ORDER BY — the connector appends `ORDER BY updated ASC` "
                "because the cursor depends on that order."
            ),
        ),
        Field(
            "max_comments",
            "Max comments per issue",
            type="number",
            default=50,
            advanced=True,
        ),
        Field("page_size", "Page size", type="number", default=50, advanced=True),
        Field("max_pages", "Max pages per poll", type="number", default=20, advanced=True),
        Field(
            "custom_fields",
            "Custom fields",
            type="keyvalue",
            advanced=True,
            placeholder="severity = customfield_10032",
            help="Mapped into document metadata, so they become search filters.",
        ),
        Field("metadata", "Extra metadata", type="keyvalue", advanced=True),
    ),
)
async def run_jira_source(collection: str, config: dict, cursor: dict) -> SourceRun:
    """config:
      base_url      — https://acme.atlassian.net
      email         — Jira Cloud account email (with api_token)
      api_token     — "${JIRA_API_TOKEN}"
      bearer_token  — alternative for Server/DC PAT auth
      jql           — e.g. "project = OPS AND statusCategory = Done"
      max_comments, page_size, max_pages
      custom_fields — {"severity": "customfield_10032"}
    """
    base_url = config["base_url"].rstrip("/")
    jql_base = config.get("jql") or ""
    page_size = int(config.get("page_size", 50))
    max_pages = int(config.get("max_pages", 20))

    # Incremental: only pull what changed since the last watermark. Jira's
    # `updated >=` has minute granularity, so re-fetching the boundary minute is
    # expected — content hashing makes the repeat a no-op.
    since = cursor.get("updated_since")
    clauses = [c for c in (jql_base, f'updated >= "{since}"' if since else None) if c]
    jql = " AND ".join(clauses) if clauses else _DEFAULT_JQL
    if "ORDER BY" not in jql.upper():
        jql += " ORDER BY updated ASC"

    headers = {"Accept": "application/json"}
    if config.get("bearer_token"):
        headers["Authorization"] = f"Bearer {config['bearer_token']}"

    fields = [
        "summary", "description", "status", "resolution", "priority",
        "components", "labels", "project", "issuetype", "created", "updated",
        "comment",
    ]
    fields += list((config.get("custom_fields") or {}).values())

    documents: list[DocumentInput] = []
    watermark = since
    start_at = 0

    async with httpx.AsyncClient(
        base_url=base_url,
        auth=_auth(config),
        headers=headers,
        timeout=settings.request_timeout_seconds,
    ) as client:
        for _ in range(max_pages):
            response = await client.get(
                "/rest/api/3/search",
                params={
                    "jql": jql,
                    "startAt": start_at,
                    "maxResults": page_size,
                    "fields": ",".join(fields),
                },
            )
            if response.status_code == 404:
                # Server/DC exposes v2 only.
                response = await client.get(
                    "/rest/api/2/search",
                    params={
                        "jql": jql,
                        "startAt": start_at,
                        "maxResults": page_size,
                        "fields": ",".join(fields),
                    },
                )
            response.raise_for_status()
            payload = response.json()
            issues = payload.get("issues") or []
            if not issues:
                break

            for issue in issues:
                content, metadata = _render_issue(issue, config)
                if not content:
                    continue
                updated = (issue.get("fields") or {}).get("updated")
                if updated and (watermark is None or updated > watermark):
                    watermark = updated
                documents.append(
                    DocumentInput(
                        collection=collection,
                        external_id=issue["key"],
                        content=content,
                        title=f"{issue['key']} {(issue.get('fields') or {}).get('summary', '')}".strip(),
                        uri=f"{base_url}/browse/{issue['key']}",
                        source_type="jira",
                        metadata={**(config.get("metadata") or {}), **metadata},
                        source_created_at=parse_dt((issue.get("fields") or {}).get("created")),
                        source_updated_at=parse_dt(updated),
                    )
                )

            start_at += len(issues)
            if start_at >= int(payload.get("total", 0)):
                break

    logger.info("jira: fetched %d issues (watermark=%s)", len(documents), watermark)
    return SourceRun(
        documents=documents,
        cursor={"updated_since": watermark} if watermark else cursor,
    )
