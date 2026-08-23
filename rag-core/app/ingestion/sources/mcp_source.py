"""Ingest from an external MCP server.

This is the opposite direction from ``app/mcp_server.py``. That one exposes our
retrieval tools *to* agents; this one makes the worker an MCP **client** so a
vendor's own MCP server becomes a data source.

The reason it exists: GitHub, Slack, Jira, Sentry and Linear all ship MCP
servers now. Writing a connector per vendor means writing their pagination,
their auth and their rate limits again each time. Pointing at their MCP server
turns "add a vendor" into filling in a form.

Two shapes of result are handled, because MCP servers genuinely return both:

* **JSON** — mapped like the ``http_json`` connector: one record becomes one
  document, addressed by ``id_field``.
* **Prose** — the whole text becomes a single document. A server that answers
  "summarise open incidents" is useful and has no records to iterate.

The cost of the generality is that this connector cannot be incremental on its
own. A tool that accepts a ``since``-style argument can be made incremental with
``cursor_argument``; one that does not will refetch every poll, and idempotent
ingestion (content hashing) is what keeps that from re-embedding anything.
"""

from __future__ import annotations

import json
import logging
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from app.ingestion.pipeline import DocumentInput
from app.ingestion.sources import (
    CheckResult,
    Field,
    SourceRun,
    check,
    parse_dt,
    pluck,
    register,
)

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 120.0


@asynccontextmanager
async def _session(config: dict) -> AsyncIterator[Any]:
    """Open an MCP session over whichever transport the config names."""
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.sse import sse_client
    from mcp.client.stdio import get_default_environment, stdio_client

    transport = (config.get("transport") or "stdio").lower()
    if transport == "stdio":
        command = config.get("command")
        if not command:
            raise ValueError("stdio transport requires `command`")
        if shutil.which(command) is None:
            raise FileNotFoundError(
                f"'{command}' is not on PATH inside the worker container. "
                f"The stdio transport runs the command here, not on your machine — "
                f"add it to the worker image, or use the sse transport against an "
                f"already-running server."
            )
        params = StdioServerParameters(
            command=command,
            args=list(config.get("args") or []),
            # get_default_environment() is a curated base — HOME and PATH, no
            # vendor keys. Passing a bare dict instead leaves PATH empty, and
            # the subprocess then cannot find its own interpreter.
            env={
                **get_default_environment(),
                **{str(k): str(v) for k, v in (config.get("env") or {}).items()},
            },
        )
        client = stdio_client(params)
    elif transport == "sse":
        if not config.get("url"):
            raise ValueError("sse transport requires `url`")
        client = sse_client(
            url=config["url"],
            headers={str(k): str(v) for k, v in (config.get("headers") or {}).items()},
        )
    else:
        raise ValueError(f"unknown MCP transport '{transport}' (expected stdio or sse)")

    async with client as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


def _result_text(result: Any) -> str:
    """Flatten a CallToolResult into text.

    Only text blocks are kept: an MCP tool may return images or embedded
    resources, and neither survives being turned into an embedding.
    """
    parts: list[str] = []
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def _records(payload: Any, items_path: str | None) -> list[dict] | None:
    """The record list, or None when the payload is not record-shaped."""
    resolved = pluck(payload, items_path, payload) if items_path else payload
    if isinstance(resolved, list) and all(isinstance(r, dict) for r in resolved):
        return resolved
    if isinstance(resolved, dict):
        return [resolved]
    return None


@check("mcp")
async def check_mcp(config: dict) -> CheckResult:
    """Connect, list tools, and confirm the configured one exists.

    Naming a tool the server does not expose is the mistake this catches, and
    listing what it does expose is usually enough to fix it on the spot — MCP
    tool names are rarely guessable.
    """
    async with _session(config) as session:
        listing = await session.list_tools()
        names = [tool.name for tool in listing.tools]
    wanted = config.get("tool")
    if wanted and wanted not in names:
        return CheckResult(
            False,
            f"server is reachable but exposes no tool '{wanted}'. "
            f"Available: {', '.join(names) or '(none)'}",
            {"tools": names},
        )
    return CheckResult(
        True,
        f"connected; {len(names)} tool(s) available"
        + (f", '{wanted}' found" if wanted else ""),
        {"tools": names},
    )


@register(
    "mcp",
    label="MCP server",
    description=(
        "Calls a tool on an external MCP server (GitHub, Sentry, Linear, an "
        "internal one) and indexes the result. Use this instead of writing a "
        "connector when the vendor already ships an MCP server."
    ),
    docs="docs/sources.md#mcp",
    fields=(
        Field(
            "transport",
            "Transport",
            type="select",
            default="stdio",
            options=("stdio", "sse"),
            help="stdio launches the server as a subprocess; sse connects to a running one.",
        ),
        Field(
            "command",
            "Command",
            placeholder="npx",
            help=(
                "stdio only. The binary must exist inside the worker container — "
                "`npx` is not there by default."
            ),
        ),
        Field(
            "args",
            "Arguments",
            type="list",
            placeholder="-y, @modelcontextprotocol/server-github",
        ),
        Field(
            "env",
            "Environment",
            type="keyvalue",
            placeholder="GITHUB_TOKEN = ${GITHUB_TOKEN}",
            help=(
                "Passed to the subprocess. Only these variables are visible to it — "
                "the worker's own environment is not inherited."
            ),
        ),
        Field("url", "Server URL", placeholder="https://mcp.internal/sse", help="sse only."),
        Field("headers", "Headers", type="keyvalue", help="sse only."),
        Field(
            "tool",
            "Tool name",
            placeholder="search_issues",
            # Deliberately not `required`: the discovery flow is to leave it
            # blank and press Test connection, which lists what the server
            # exposes. A required field would be rejected before the probe runs.
            help=(
                "Required to sync. Leave blank and press Test connection to list "
                "what this server exposes — MCP tool names are rarely guessable."
            ),
        ),
        Field("arguments", "Tool arguments", type="keyvalue"),
        Field(
            "cursor_argument",
            "Cursor argument",
            advanced=True,
            placeholder="since",
            help=(
                "Argument that carries the last-seen timestamp back on the next poll. "
                "Without it every poll refetches everything."
            ),
        ),
        Field(
            "items_path",
            "Items path",
            advanced=True,
            placeholder="issues",
            help="Dotted path to the record array, when the tool returns JSON.",
        ),
        Field(
            "id_field",
            "ID field",
            advanced=True,
            placeholder="id",
            help="Required for JSON results. Prose results use a single fixed document id.",
        ),
        Field("content_fields", "Content fields", type="list", advanced=True),
        Field("title_field", "Title field", advanced=True),
        Field("uri_field", "URI field", advanced=True),
        Field("updated_field", "Updated field", advanced=True),
        Field("metadata_fields", "Metadata from fields", type="keyvalue", advanced=True),
        Field("metadata", "Extra metadata", type="keyvalue", advanced=True),
        Field(
            "document_id",
            "Document ID (prose mode)",
            advanced=True,
            help="External id used when the tool returns text rather than records.",
        ),
    ),
)
async def run_mcp_source(collection: str, config: dict, cursor: dict) -> SourceRun:
    tool_name = config.get("tool")
    if not tool_name:
        raise ValueError(
            "config.tool is required to sync. Run Test connection with it blank "
            "to list the tools this server exposes."
        )
    arguments = dict(config.get("arguments") or {})

    cursor_argument = config.get("cursor_argument")
    if cursor_argument and cursor.get("watermark"):
        arguments[cursor_argument] = cursor["watermark"]

    async with _session(config) as session:
        result = await session.call_tool(tool_name, arguments)

    if getattr(result, "isError", False):
        raise RuntimeError(f"MCP tool '{tool_name}' returned an error: {_result_text(result)}")

    text = _result_text(result)
    if not text:
        logger.info("MCP tool %s returned no text content", tool_name)
        return SourceRun(documents=[], cursor=cursor)

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None

    records = _records(payload, config.get("items_path")) if payload is not None else None

    # Prose mode: one document, stable id, content hashing makes repeat polls
    # free when the answer has not changed.
    if records is None or not config.get("id_field"):
        external_id = config.get("document_id") or f"mcp:{tool_name}"
        return SourceRun(
            documents=[
                DocumentInput(
                    collection=collection,
                    external_id=external_id,
                    content=text,
                    title=config.get("title_field") or f"{tool_name} (MCP)",
                    source_type="mcp",
                    metadata={
                        **(config.get("metadata") or {}),
                        "mcp_tool": tool_name,
                        "mcp_transport": config.get("transport", "stdio"),
                    },
                )
            ],
            cursor={"fetched_at": datetime.now(timezone.utc).isoformat()},
        )

    documents: list[DocumentInput] = []
    watermark = cursor.get("watermark")
    content_fields = config.get("content_fields") or []
    updated_field = config.get("updated_field")

    for record in records:
        external_id = pluck(record, config["id_field"])
        if external_id is None:
            continue
        if content_fields:
            body = "\n\n".join(
                str(pluck(record, path))
                for path in content_fields
                if pluck(record, path) is not None
            )
        else:
            # No mapping given: index the record verbatim rather than silently
            # indexing nothing.
            body = json.dumps(record, indent=2, ensure_ascii=False)
        if not body.strip():
            continue

        updated = parse_dt(pluck(record, updated_field)) if updated_field else None
        if updated and (watermark is None or updated.isoformat() > str(watermark)):
            watermark = updated.isoformat()

        documents.append(
            DocumentInput(
                collection=collection,
                external_id=f"{tool_name}:{external_id}",
                content=body,
                title=pluck(record, config.get("title_field")),
                uri=pluck(record, config.get("uri_field")),
                source_type="mcp",
                source_updated_at=updated,
                metadata={
                    **(config.get("metadata") or {}),
                    "mcp_tool": tool_name,
                    **{
                        key: pluck(record, path)
                        for key, path in (config.get("metadata_fields") or {}).items()
                    },
                },
            )
        )

    logger.info("MCP tool %s produced %d documents", tool_name, len(documents))
    return SourceRun(
        documents=documents,
        cursor={"watermark": watermark} if watermark else cursor,
    )
