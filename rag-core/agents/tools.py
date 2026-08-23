"""CrewAI tools over the RAG REST API.

These are thin HTTP wrappers, not a second implementation. Every guardrail —
the confidence gate, citation validation, the groundedness judge, tracing —
lives behind the API, so an agent using these tools gets exactly the same
guarantees as a curl user and lands in the same traces.

The MCP server (``app/mcp_server.py``) exposes an identical surface. REST is
the default here because plain HTTP is stable across CrewAI releases and can be
unit-tested without launching a subprocess; swapping to ``MCPServerAdapter`` is
a wiring change, not a redesign.
"""

from __future__ import annotations

from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from agents.client import call as _call
from agents.client import dumps as _dumps


# --------------------------------------------------------------- rag_search
class SearchInput(BaseModel):
    query: str = Field(
        description=(
            "Natural-language question or symptom. Include exact identifiers "
            "(error codes, service names, SQL object names) — they are matched "
            "literally by the lexical branch."
        )
    )
    collections: list[str] | None = Field(
        default=None, description="Restrict to these collections. Omit to search all."
    )
    filters: dict[str, str] | None = Field(
        default=None,
        description='Metadata equality filter, e.g. {"service": "payments-api"}.',
    )
    top_k: int = Field(default=6, description="How many passages to return.")


class RagSearchTool(BaseTool):
    name: str = "rag_search"
    description: str = (
        "Search the operational knowledge base (runbooks, resolved incidents, "
        "chat threads, SQL, log patterns) and return raw passages with scores "
        "and source metadata. No answer is generated and no LLM tokens are "
        "spent — use this when you want evidence to reason over yourself."
    )
    args_schema: Type[BaseModel] = SearchInput

    def _run(
        self,
        query: str,
        collections: list[str] | None = None,
        filters: dict[str, str] | None = None,
        top_k: int = 6,
    ) -> str:
        payload = _call(
            "POST",
            "/search",
            {
                "query": query,
                "collections": collections,
                "filters": filters or {},
                "top_k": top_k,
            },
        )
        results = payload.get("results", []) if isinstance(payload, dict) else []
        if not results:
            return "No passages matched. Try fewer filters or different terms."
        return _dumps(
            [
                {
                    "chunk_id": r["chunk_id"],
                    "source": f"{r['collection']}/{r['external_id']}",
                    "title": r.get("title"),
                    "score": r["score"],
                    "retrieval_mode": r["retrieval_mode"],
                    "metadata": r.get("metadata", {}),
                    "content": r["content"],
                }
                for r in results
            ]
        )


# --------------------------------------------------------------- rag_answer
class AnswerInput(BaseModel):
    query: str = Field(description="The question to answer from the knowledge base.")
    collections: list[str] | None = Field(default=None)
    filters: dict[str, str] | None = Field(default=None)
    incident_id: str | None = Field(
        default=None,
        description=(
            "Correlation id so all calls for one incident group. Required by "
            "the service: without it the trace cannot be found afterwards."
        ),
    )


class RagAnswerTool(BaseTool):
    name: str = "rag_answer"
    description: str = (
        "Answer a question from the knowledge base, grounded in retrieved "
        "passages. Returns the answer plus citations, a confidence score and a "
        "groundedness verdict. IMPORTANT: if the response says abstained=true, "
        "the knowledge base does not contain the answer — report that gap "
        "explicitly. Do not substitute your own knowledge without saying so."
    )
    args_schema: Type[BaseModel] = AnswerInput

    def _run(
        self,
        query: str,
        collections: list[str] | None = None,
        filters: dict[str, str] | None = None,
        incident_id: str | None = None,
    ) -> str:
        payload = _call(
            "POST",
            "/answer",
            {
                "query": query,
                "collections": collections,
                "filters": filters or {},
                "incident_id": incident_id,
                "agent_id": "crewai",
            },
        )
        assert isinstance(payload, dict)
        if payload.get("abstained"):
            return _dumps(
                {
                    "abstained": True,
                    "reason": payload.get("abstain_reason"),
                    "message": (
                        "The knowledge base cannot support an answer. Report this "
                        "gap rather than filling it from prior knowledge."
                    ),
                    "closest_passages": [
                        {
                            "source": f"{s['collection']}/{s['external_id']}",
                            "score": s["score"],
                        }
                        for s in payload.get("sources", [])[:3]
                    ],
                }
            )
        return _dumps(
            {
                "answer": payload.get("answer"),
                "confidence": payload.get("confidence"),
                "citations": payload.get("citations", []),
                "groundedness": payload.get("groundedness"),
                "warnings": payload.get("warnings", []),
                "query_log_id": payload.get("query_log_id"),
            }
        )


# -------------------------------------------------------------- rag_ingest
class IngestInput(BaseModel):
    collection: str = Field(description="Target collection, e.g. 'incidents'.")
    external_id: str = Field(
        description="Stable id. Re-using it updates the existing document."
    )
    content: str = Field(description="Markdown body.")
    title: str | None = Field(default=None)
    metadata: dict[str, Any] | None = Field(
        default=None, description='Filterable facets, e.g. {"service": "payments-api"}.'
    )


class RagIngestTool(BaseTool):
    name: str = "rag_ingest"
    description: str = (
        "Write a document into the knowledge base. Idempotent on "
        "(collection, external_id). Use this to record what an investigation "
        "learned — a resolved incident summary is the highest-value content "
        "this index can hold."
    )
    args_schema: Type[BaseModel] = IngestInput

    def _run(
        self,
        collection: str,
        external_id: str,
        content: str,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        payload = _call(
            "POST",
            "/documents",
            {
                "mode": "sync",
                "documents": [
                    {
                        "collection": collection,
                        "external_id": external_id,
                        "content": content,
                        "title": title,
                        "source_type": "crewai",
                        "metadata": metadata or {},
                    }
                ],
            },
        )
        return _dumps(payload)


# ------------------------------------------------------------- rag_feedback
class FeedbackInput(BaseModel):
    chunk_id: str = Field(description="chunk_id from a search result or citation.")
    rating: int = Field(description="1 = helped, -1 = misleading or irrelevant.")
    reason: str | None = Field(default=None)
    query_log_id: str | None = Field(default=None)


class RagFeedbackTool(BaseTool):
    name: str = "rag_feedback"
    description: str = (
        "Record whether a passage actually helped. Ratings adjust that chunk's "
        "ranking on future searches, so calling this after acting on an answer "
        "is how the knowledge base improves."
    )
    args_schema: Type[BaseModel] = FeedbackInput

    def _run(
        self,
        chunk_id: str,
        rating: int,
        reason: str | None = None,
        query_log_id: str | None = None,
    ) -> str:
        payload = _call(
            "POST",
            "/feedback",
            {
                "chunk_id": chunk_id,
                "rating": max(-1, min(1, int(rating))),
                "reason": reason,
                "query_log_id": query_log_id,
                "agent_id": "crewai",
            },
        )
        return _dumps(payload)


# ------------------------------------------------------- rag_list_collections
class NoInput(BaseModel):
    pass


class RagListCollectionsTool(BaseTool):
    name: str = "rag_list_collections"
    description: str = (
        "List the available collections with document and chunk counts. Call "
        "this first when you do not know how the knowledge base is organized."
    )
    args_schema: Type[BaseModel] = NoInput

    def _run(self) -> str:
        payload = _call("GET", "/collections")
        assert isinstance(payload, list)
        return _dumps(
            [
                {
                    "name": c["name"],
                    "description": c.get("description"),
                    "documents": c["document_count"],
                    "chunks": c["chunk_count"],
                }
                for c in payload
            ]
        )


# ------------------------------------------------------------ rag_pin_trace
class PinInput(BaseModel):
    query_log_id: str = Field(
        description="The query_log_id returned by rag_answer for the answer being relied on."
    )
    reason: str = Field(
        description="Why it must be kept — a PR URL, a postmortem link, an audit reference."
    )


class RagPinTraceTool(BaseTool):
    name: str = "rag_pin_trace"
    description: str = (
        "Keep a trace permanently. Traces are deleted after the retention "
        "window; anything referenced from something durable — a pull request, "
        "a postmortem — must be pinned or the reference will break. Call this "
        "for every answer whose conclusion you are acting on."
    )
    args_schema: Type[BaseModel] = PinInput

    def _run(self, query_log_id: str, reason: str) -> str:
        return _dumps(_call("POST", f"/traces/{query_log_id}/pin", {"reason": reason}))


# ------------------------------------------------------- rag_incident_traces
class IncidentInput(BaseModel):
    incident_id: str = Field(description="The incident correlation id.")


class RagIncidentTracesTool(BaseTool):
    name: str = "rag_incident_traces"
    description: str = (
        "Replay every question already asked about this incident, oldest "
        "first, with its answer, citations and verdict — including where the "
        "service abstained. Call this before searching to avoid repeating work "
        "another agent already did, and to see which gaps are already known."
    )
    args_schema: Type[BaseModel] = IncidentInput

    def _run(self, incident_id: str) -> str:
        payload = _call("GET", f"/incidents/{incident_id}/traces")
        assert isinstance(payload, dict)
        return _dumps(
            {
                "incident_id": payload["incident_id"],
                "count": payload["count"],
                "traces": [
                    {
                        "query_log_id": t["id"],
                        "query": t["query"],
                        "answer": t["answer"],
                        "abstained": t["abstained"],
                        "citations": [c.get("external_id") for c in t.get("citations") or []],
                        "groundedness": (t.get("groundedness") or {}).get("verdict"),
                        "pinned": t.get("pinned"),
                    }
                    for t in payload["traces"]
                ],
            }
        )


def all_tools() -> list[BaseTool]:
    return [
        RagListCollectionsTool(),
        RagSearchTool(),
        RagAnswerTool(),
        RagIngestTool(),
        RagFeedbackTool(),
        RagPinTraceTool(),
        RagIncidentTracesTool(),
    ]
