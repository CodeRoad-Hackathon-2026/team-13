"""HTTP client for RAG Core.

Server-to-server only. The X-API-Key never leaves this process — that is the
whole reason this layer exists between the dashboard and the RAG.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import settings


class RagError(RuntimeError):
    """RAG Core refused or failed a call.

    Carries the status so a caller can tell "the RAG is down" (retry later)
    from "the request was wrong" (a bug here).
    """

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"RAG Core returned {status}: {detail}")
        self.status = status
        self.detail = detail


class RagClient:
    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(
            base_url=settings.rag_api_url,
            headers={"X-API-Key": settings.rag_api_key},
            timeout=settings.rag_timeout_seconds,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._client.post(path, json=payload)
        except httpx.HTTPError as exc:  # network, DNS, timeout
            raise RagError(0, str(exc)) from exc
        if response.status_code >= 400:
            raise RagError(response.status_code, response.text[:500])
        return response.json()

    async def _get(self, path: str) -> Any:
        """The read half, which this client did not have.

        `_post` was the only transport, so nothing here could issue a GET to RAG
        Core at all — every read the orchestrator wanted had to be a POST with a
        body, or not happen.
        """
        try:
            response = await self._client.get(path)
        except httpx.HTTPError as exc:  # network, DNS, timeout
            raise RagError(0, str(exc)) from exc
        if response.status_code >= 400:
            raise RagError(response.status_code, response.text[:500])
        return response.json()

    async def list_sources(self) -> list[dict[str, Any]]:
        """The knowledge sources RAG Core polls.

        Read-only by design: the credentials on a source are handled by RAG Core's
        own admin UI, behind its own key. See app/api/agents.py:list_connections.
        RAG Core redacts every secret-shaped value before it leaves that process,
        but not reaching for the write endpoints is the actual guarantee.
        """
        result = await self._get("/sources")
        return result if isinstance(result, list) else []

    async def search(
        self,
        query: str,
        *,
        top_k: int | None = None,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Retrieval only — no generation, no LLM tokens.

        The endpoint RAG Core itself documents as "what an agent should call
        when it wants evidence to reason over rather than prose".
        """
        return await self._post(
            "/search",
            {
                "query": query,
                "collections": settings.rag_collections,
                "filters": filters or {},
                "top_k": top_k or settings.retrieval_top_k,
                "rerank": True,
            },
        )

    async def ensure_collection(self, name: str, description: str | None = None) -> None:
        """Create the collection if it is not there yet.

        Ingestion 400s against a collection that does not exist, and RAG Core
        does not create one implicitly — deliberately, so a typo in a collection
        name cannot silently scatter a corpus across several of them.
        """
        try:
            await self._post("/collections", {"name": name, "description": description})
        except RagError as exc:
            # 409 means it already exists, which is the whole point of "ensure".
            if exc.status != 409:
                raise

    async def ingest_document(
        self,
        *,
        external_id: str,
        title: str,
        content: str,
        source_url: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Push one document into the RAG corpus.

        `external_id` is this database's knowledge_documents.id. That is the whole
        linkage: retrieval hands the id back on every hit, and
        RagRetrievalAgent._resolve_document maps it to a local row. Send anything
        else and matches become unlinkable.

        Synchronous ingestion: the caller is a background agent that has just
        resolved an incident, and it should learn now whether the write landed
        rather than discover a silent failure at the next retrieval.
        """
        return await self._post(
            "/documents",
            {
                "documents": [
                    {
                        "collection": settings.rag_ingest_collection,
                        "external_id": external_id,
                        "title": title,
                        "content": content,
                        "uri": source_url,
                        "source_type": "incident-orchestrator",
                        "metadata": metadata or {},
                    }
                ],
                "mode": "sync",
            },
        )

    async def submit_feedback(
        self,
        *,
        query_log_id: str,
        rating: int,
        reason: str | None = None,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Tell RAG Core how a retrieval turned out.

        Its hybrid ranking carries a feedback component, so a rejected
        recommendation makes the sources behind it rank lower next time. Without
        this the operator's judgement stops at our database.
        """
        return await self._post(
            "/feedback",
            {
                "query_log_id": query_log_id,
                "rating": rating,
                "reason": reason,
                "agent_id": agent_id,
            },
        )

    async def answer(
        self,
        query: str,
        *,
        incident_id: str,
        agent_id: str | None = None,
        top_k: int | None = None,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Grounded answer with citations.

        `incident_id` is mandatory upstream, not decorative: it is the
        correlation id that makes GET /v1/incidents/{id}/traces able to
        reconstruct everything asked during one incident.
        """
        return await self._post(
            "/answer",
            {
                "query": query,
                "collections": settings.rag_collections,
                "filters": filters or {},
                "top_k": top_k or settings.retrieval_top_k,
                "agent_id": agent_id,
                "incident_id": incident_id,
            },
        )


_shared: RagClient | None = None


def get_rag_client() -> RagClient:
    """One client for the process.

    httpx pools connections, and a client per request would throw that away —
    plus RAG Core is rate-limited per API key, so churning connections buys
    nothing and costs handshakes.
    """
    global _shared
    if _shared is None:
        _shared = RagClient()
    return _shared


async def close_rag_client() -> None:
    global _shared
    if _shared is not None:
        await _shared.aclose()
        _shared = None
