"""MCP server exposing the RAG service as agent tools.

Runs over stdio and talks to the REST API over HTTP — it is a thin client, not
a second implementation. Every guardrail (confidence gate, citation validation,
groundedness judge, tracing) lives behind the API, so an MCP caller and a plain
HTTP caller get identical behaviour and appear in the same traces.

    python -m app.mcp_server

Claude Code / Claude Desktop config:

    {
      "mcpServers": {
        "rag": {
          "command": "python",
          "args": ["-m", "app.mcp_server"],
          "cwd": "/path/to/hackaton",
          "env": {
            "RAG_API_URL": "http://localhost:8000/v1",
            "RAG_API_KEY": "rag_sk_..."
          }
        }
      }
    }
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any

import httpx

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import TextContent, Tool
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "the `mcp` package is required to run the MCP server: pip install mcp\n"
    )
    raise

API_URL = os.environ.get("RAG_API_URL", "http://localhost:8000/v1").rstrip("/")
API_KEY = os.environ.get("RAG_API_KEY", "")
TIMEOUT = float(os.environ.get("RAG_MCP_TIMEOUT", "120"))

# stdio is the protocol channel — anything written to stdout corrupts the
# session, so logs must go to stderr.
logging.basicConfig(level=os.environ.get("RAG_MCP_LOG_LEVEL", "INFO"), stream=sys.stderr)
logger = logging.getLogger("rag-mcp")

server = Server("rag-core")


async def _request(method: str, path: str, payload: dict | None = None) -> dict:
    async with httpx.AsyncClient(
        base_url=API_URL,
        headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
        timeout=TIMEOUT,
    ) as client:
        response = await client.request(method, path, json=payload)
        if response.status_code >= 400:
            # Surface the API's own message: an agent can act on "collection
            # does not exist" but not on a bare 422.
            try:
                detail = response.json().get("detail", response.text)
            except Exception:  # noqa: BLE001
                detail = response.text
            raise RuntimeError(f"{method} {path} -> {response.status_code}: {detail}")
        return response.json()


TOOLS = [
    Tool(
        name="rag_search",
        description=(
            "Search the knowledge base and return the raw passages, with scores and "
            "source metadata. No answer is generated and no LLM tokens are spent — "
            "use this when you want evidence to reason over yourself. Prefer it over "
            "rag_answer when you will combine the evidence with other context."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural-language question or symptom. Include exact "
                    "identifiers (error codes, service names) — they are matched literally "
                    "by the lexical branch.",
                },
                "collections": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Restrict to these collections. Omit to search all.",
                },
                "filters": {
                    "type": "object",
                    "description": 'Metadata equality filter, e.g. {"service": "payments-api", "severity": "P1"}.',
                },
                "top_k": {"type": "integer", "minimum": 1, "maximum": 50, "default": 8},
            },
            "required": ["query"],
        },
    ),
    Tool(
        name="rag_answer",
        description=(
            "Answer a question from the knowledge base, grounded in retrieved passages. "
            "Returns the answer plus its citations, a confidence score, and a groundedness "
            "verdict. If the corpus cannot support an answer the service abstains rather "
            "than guessing — treat `abstained: true` as 'not in the knowledge base', not as "
            "a failure, and do not fill the gap from your own knowledge without saying so."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "collections": {"type": "array", "items": {"type": "string"}},
                "filters": {"type": "object"},
                "top_k": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
                "incident_id": {
                    "type": "string",
                    "description": "Correlation id for the incident being worked. "
                    "Required: it is what lets every call made during one incident "
                    "be pulled from the traces together, and an answer logged "
                    "without it cannot be found again afterwards. Pass the id you "
                    "were given — do not invent one per call.",
                },
                "agent_id": {"type": "string"},
            },
            "required": ["query", "incident_id"],
        },
    ),
    Tool(
        name="rag_ingest",
        description=(
            "Add or update a document in the knowledge base. Ingestion is idempotent on "
            "(collection, external_id): posting the same content twice is a no-op, and "
            "posting changed content replaces it. Use this to write back what an "
            "investigation learned — a resolved incident summary is the highest-value "
            "content this index can hold."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "collection": {"type": "string"},
                "external_id": {
                    "type": "string",
                    "description": "Stable id in the origin system (ticket key, file path). "
                    "Re-using it updates the existing document.",
                },
                "content": {"type": "string", "description": "Markdown body."},
                "title": {"type": "string"},
                "uri": {"type": "string"},
                "metadata": {
                    "type": "object",
                    "description": 'Filterable facets, e.g. {"service": "payments-api", "kind": "incident"}.',
                },
            },
            "required": ["collection", "external_id", "content"],
        },
    ),
    Tool(
        name="rag_feedback",
        description=(
            "Record whether a retrieved passage actually helped. Ratings adjust that "
            "chunk's ranking on future searches, so calling this after acting on an "
            "answer is how the index improves. Use chunk_id from a rag_search result or "
            "from a rag_answer citation."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "chunk_id": {"type": "string"},
                "query_log_id": {
                    "type": "string",
                    "description": "From a rag_answer response, to tie feedback to the query.",
                },
                "rating": {
                    "type": "integer",
                    "enum": [-1, 0, 1],
                    "description": "1 = helped, -1 = misleading or irrelevant, 0 = neutral.",
                },
                "reason": {"type": "string"},
                "agent_id": {"type": "string"},
            },
            "required": ["rating"],
        },
    ),
    Tool(
        name="rag_list_collections",
        description=(
            "List the available collections with their document and chunk counts. Call "
            "this first when you do not know how the knowledge base is organized."
        ),
        inputSchema={"type": "object", "properties": {}},
    ),
]


@server.list_tools()
async def list_tools() -> list[Tool]:
    return TOOLS


def _compact_search(payload: dict) -> dict:
    """Trim search results for the model's context window.

    The REST response carries every score component for debugging; an agent
    needs the text, where it came from, and how confident the match is.
    """
    return {
        "query": payload.get("query"),
        "took_ms": payload.get("took_ms"),
        "results": [
            {
                "chunk_id": r["chunk_id"],
                "collection": r["collection"],
                "source": r["external_id"],
                "title": r.get("title"),
                "uri": r.get("uri"),
                "score": r["score"],
                "retrieval_mode": r["retrieval_mode"],
                "metadata": r.get("metadata", {}),
                "content": r["content"],
            }
            for r in payload.get("results", [])
        ],
    }


def _compact_answer(payload: dict) -> dict:
    return {
        "answer": payload.get("answer"),
        "abstained": payload.get("abstained"),
        "abstain_reason": payload.get("abstain_reason"),
        "confidence": payload.get("confidence"),
        "citations": payload.get("citations", []),
        "groundedness": payload.get("groundedness"),
        "warnings": payload.get("warnings", []),
        "query_log_id": payload.get("query_log_id"),
        # An agent whose output becomes a PR has to be able to record what
        # produced the answer. query_log_id alone is not enough: traces expire
        # unless pinned, and the prompt may have moved on by the time anyone
        # reads the PR.
        "prompt_versions": payload.get("prompt_versions", {}),
        # Full passages stay available, but after the verdict — an agent that
        # only reads the answer should hit the guardrail results first.
        "sources": [
            {
                "chunk_id": s["chunk_id"],
                "source": s["external_id"],
                "score": s["score"],
                "content": s["content"],
            }
            for s in payload.get("sources", [])
        ],
    }


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    try:
        if name == "rag_search":
            body = {
                "query": arguments["query"],
                "collections": arguments.get("collections"),
                "filters": arguments.get("filters") or {},
                "top_k": arguments.get("top_k", 8),
            }
            result = _compact_search(await _request("POST", "/search", body))

        elif name == "rag_answer":
            body = {
                "query": arguments["query"],
                "collections": arguments.get("collections"),
                "filters": arguments.get("filters") or {},
                "top_k": arguments.get("top_k", 8),
                "incident_id": arguments.get("incident_id"),
                "agent_id": arguments.get("agent_id", "mcp"),
            }
            result = _compact_answer(await _request("POST", "/answer", body))

        elif name == "rag_ingest":
            body = {
                "mode": "sync",
                "documents": [
                    {
                        "collection": arguments["collection"],
                        "external_id": arguments["external_id"],
                        "content": arguments["content"],
                        "title": arguments.get("title"),
                        "uri": arguments.get("uri"),
                        "source_type": "agent",
                        "metadata": arguments.get("metadata") or {},
                    }
                ],
            }
            result = await _request("POST", "/documents", body)

        elif name == "rag_feedback":
            result = await _request(
                "POST",
                "/feedback",
                {
                    "chunk_id": arguments.get("chunk_id"),
                    "query_log_id": arguments.get("query_log_id"),
                    "rating": arguments["rating"],
                    "reason": arguments.get("reason"),
                    "agent_id": arguments.get("agent_id", "mcp"),
                },
            )

        elif name == "rag_list_collections":
            result = {"collections": await _request("GET", "/collections")}

        else:
            raise ValueError(f"unknown tool: {name}")

    except Exception as exc:  # noqa: BLE001
        # Returning the error as content (rather than raising) lets the agent
        # read what went wrong and adjust, instead of seeing a dead tool.
        logger.exception("tool %s failed", name)
        return [TextContent(type="text", text=f"Error calling {name}: {exc}")]

    return [TextContent(type="text", text=json.dumps(result, indent=2, default=str))]


async def main() -> None:
    if not API_KEY:
        logger.warning("RAG_API_KEY is not set; the API will reject every call")
    logger.info("rag-core MCP server -> %s", API_URL)
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
