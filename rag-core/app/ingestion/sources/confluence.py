"""Confluence connector — wiki pages (runbooks, architecture, procedures)."""

from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.ingestion.pipeline import DocumentInput
from app.ingestion.sources import (
    CheckResult,
    Field,
    SourceRun,
    check,
    html_to_text,
    parse_dt,
    register,
)

logger = logging.getLogger(__name__)


@check("confluence")
async def check_confluence(config: dict) -> CheckResult:
    base_url = config["base_url"].rstrip("/")
    headers = {"Accept": "application/json"}
    if config.get("bearer_token"):
        headers["Authorization"] = f"Bearer {config['bearer_token']}"
    auth = (
        httpx.BasicAuth(config["email"], config["api_token"])
        if config.get("email") and config.get("api_token")
        else None
    )
    cql = config.get("cql") or (
        f'space = "{config["space"]}" AND type = page' if config.get("space") else "type = page"
    )
    async with httpx.AsyncClient(
        base_url=base_url, headers=headers, auth=auth, timeout=20.0
    ) as client:
        response = await client.get(
            "/rest/api/content/search", params={"cql": cql, "limit": 1}
        )
        if response.status_code in (401, 403):
            return CheckResult(False, f"authentication rejected ({response.status_code})")
        if response.status_code == 400:
            return CheckResult(False, f"CQL rejected: {response.text[:300]}")
        response.raise_for_status()
        total = response.json().get("size", 0)
    return CheckResult(
        total > 0,
        f"CQL matches {total} page(s)" if total else "authenticated, but the CQL matches nothing",
        {"cql": cql},
    )


@register(
    "confluence",
    label="Confluence",
    description="Indexes pages by CQL or by space, converting storage-format HTML to text.",
    docs="docs/sources.md#confluence",
    fields=(
        Field(
            "base_url",
            "Base URL",
            required=True,
            placeholder="https://acme.atlassian.net/wiki",
            help="Include the /wiki suffix on Confluence Cloud.",
        ),
        Field("email", "Account email"),
        Field("api_token", "API token", type="secret", placeholder="${CONFLUENCE_API_TOKEN}"),
        Field("bearer_token", "Bearer token (Server/DC)", type="secret"),
        Field(
            "space",
            "Space key",
            placeholder="OPS",
            help="Shorthand for a CQL of `space = \"OPS\" AND type = page`. Ignored if CQL is set.",
        ),
        Field(
            "cql",
            "CQL filter",
            type="textarea",
            placeholder='space = "OPS" AND type = page AND label = "runbook"',
        ),
        Field("page_size", "Page size", type="number", default=50, advanced=True),
        Field("max_pages", "Max pages per poll", type="number", default=20, advanced=True),
        Field("metadata", "Extra metadata", type="keyvalue", advanced=True),
    ),
)
async def run_confluence_source(
    collection: str, config: dict, cursor: dict
) -> SourceRun:
    """config:
      base_url   — https://acme.atlassian.net/wiki
      email + api_token, or bearer_token
      cql        — e.g. 'space = "OPS" AND type = page'
      space      — shorthand for a single-space CQL
      page_size, max_pages, metadata{}
    """
    base_url = config["base_url"].rstrip("/")
    page_size = int(config.get("page_size", 50))
    max_pages = int(config.get("max_pages", 20))

    cql = config.get("cql")
    if not cql:
        space = config.get("space")
        cql = f'type = page AND space = "{space}"' if space else "type = page"
    # Incremental: Confluence CQL compares against a yyyy/MM/dd HH:mm timestamp.
    since = cursor.get("modified_since")
    if since:
        cql = f'{cql} AND lastmodified >= "{since}"'
    cql += " ORDER BY lastmodified ASC"

    auth = (
        httpx.BasicAuth(config["email"], config["api_token"])
        if config.get("email") and config.get("api_token")
        else None
    )
    headers = {"Accept": "application/json"}
    if config.get("bearer_token"):
        headers["Authorization"] = f"Bearer {config['bearer_token']}"

    documents: list[DocumentInput] = []
    watermark = since
    start = 0

    async with httpx.AsyncClient(
        base_url=base_url, auth=auth, headers=headers,
        timeout=settings.request_timeout_seconds,
    ) as client:
        for _ in range(max_pages):
            response = await client.get(
                "/rest/api/content/search",
                params={
                    "cql": cql,
                    "start": start,
                    "limit": page_size,
                    "expand": "body.storage,version,space,metadata.labels",
                },
            )
            response.raise_for_status()
            payload = response.json()
            results = payload.get("results") or []
            if not results:
                break

            for page in results:
                storage = ((page.get("body") or {}).get("storage") or {}).get("value", "")
                body = html_to_text(storage)
                if not body.strip():
                    continue

                version = page.get("version") or {}
                modified = version.get("when")
                if modified and (watermark is None or modified > watermark):
                    watermark = modified

                labels = [
                    label.get("name")
                    for label in (
                        ((page.get("metadata") or {}).get("labels") or {}).get("results")
                        or []
                    )
                    if label.get("name")
                ]

                documents.append(
                    DocumentInput(
                        collection=collection,
                        external_id=f"confluence:{page['id']}",
                        content=f"# {page.get('title', '')}\n\n{body}",
                        title=page.get("title"),
                        uri=f"{base_url}/spaces/{(page.get('space') or {}).get('key','')}/pages/{page['id']}",
                        source_type="confluence",
                        metadata={
                            **(config.get("metadata") or {}),
                            "kind": "runbook",
                            "space": (page.get("space") or {}).get("key"),
                            "page_id": page["id"],
                            "version": version.get("number"),
                            **({"labels": labels} if labels else {}),
                        },
                        source_updated_at=parse_dt(modified),
                    )
                )

            start += len(results)
            if len(results) < page_size:
                break

    logger.info("confluence: %d pages (watermark=%s)", len(documents), watermark)
    # CQL's lastmodified has minute granularity; re-fetching the boundary is
    # cheap because unchanged content hashes to a no-op.
    return SourceRun(
        documents=documents,
        cursor={"modified_since": watermark[:16].replace("-", "/").replace("T", " ")}
        if watermark
        else cursor,
    )
