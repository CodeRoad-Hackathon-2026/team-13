"""Rerank adapters.

Reranking is the step that most reduces hallucination in this pipeline: fusion
gets the right chunk into the top 30, the cross-encoder gets it into the top 3,
and the generator only ever sees the top 3.
"""

from __future__ import annotations

import json
from typing import Sequence

import httpx

from app.config import settings
from app.providers.base import LLMProvider, ProviderError, RerankProvider, RerankResult
from app.providers.base import LLMMessage


class VoyageRerank(RerankProvider):
    name = "voyage"

    def __init__(self, model: str, api_key: str | None):
        if not api_key:
            raise ProviderError("VOYAGE_API_KEY is required for the voyage reranker")
        self.model = model
        self._client = httpx.AsyncClient(
            base_url="https://api.voyageai.com/v1",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=settings.request_timeout_seconds,
        )

    async def rerank(
        self, query: str, documents: Sequence[str], top_n: int
    ) -> list[RerankResult]:
        resp = await self._client.post(
            "/rerank",
            json={
                "query": query,
                "documents": list(documents),
                "model": self.model,
                "top_k": min(top_n, len(documents)),
            },
        )
        if resp.status_code >= 400:
            raise ProviderError(f"voyage rerank failed: {resp.text}")
        return [
            RerankResult(index=item["index"], score=float(item["relevance_score"]))
            for item in resp.json()["data"]
        ]

    async def aclose(self) -> None:
        await self._client.aclose()


class CohereRerank(RerankProvider):
    name = "cohere"

    def __init__(self, model: str, api_key: str | None):
        if not api_key:
            raise ProviderError("COHERE_API_KEY is required for the cohere reranker")
        self.model = model
        self._client = httpx.AsyncClient(
            base_url="https://api.cohere.com/v2",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=settings.request_timeout_seconds,
        )

    async def rerank(
        self, query: str, documents: Sequence[str], top_n: int
    ) -> list[RerankResult]:
        resp = await self._client.post(
            "/rerank",
            json={
                "query": query,
                "documents": list(documents),
                "model": self.model,
                "top_n": min(top_n, len(documents)),
            },
        )
        if resp.status_code >= 400:
            raise ProviderError(f"cohere rerank failed: {resp.text}")
        return [
            RerankResult(index=item["index"], score=float(item["relevance_score"]))
            for item in resp.json()["results"]
        ]

    async def aclose(self) -> None:
        await self._client.aclose()


_LLM_RERANK_SCHEMA = {
    "type": "object",
    "properties": {
        "rankings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "score": {"type": "number"},
                },
                "required": ["index", "score"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["rankings"],
    "additionalProperties": False,
}

_LLM_RERANK_SYSTEM = """You score how well each passage answers an operator's question about a live incident.

Score each passage from 0.0 to 1.0:
- 1.0: contains the direct answer, procedure, or root cause.
- 0.5: same system or symptom, but does not resolve the question.
- 0.0: unrelated.

Score every passage you are given, by its index. Judge only the passage text — do not use outside knowledge."""


class LLMRerank(RerankProvider):
    """Fallback reranker for deployments with no dedicated rerank endpoint."""

    name = "llm"

    def __init__(self, llm: LLMProvider):
        self._llm = llm
        self.model = f"llm:{llm.model}"

    async def rerank(
        self, query: str, documents: Sequence[str], top_n: int
    ) -> list[RerankResult]:
        listing = "\n\n".join(
            f"[{i}] {doc[:1500]}" for i, doc in enumerate(documents)
        )
        payload = await self._llm.structured(
            system=_LLM_RERANK_SYSTEM,
            messages=[
                LLMMessage(
                    role="user", content=f"Question: {query}\n\nPassages:\n{listing}"
                )
            ],
            schema=_LLM_RERANK_SCHEMA,
            effort="low",
        )
        ranked = [
            RerankResult(index=int(r["index"]), score=float(r["score"]))
            for r in payload.get("rankings", [])
            if 0 <= int(r["index"]) < len(documents)
        ]
        ranked.sort(key=lambda r: r.score, reverse=True)
        return ranked[:top_n]


class NoopRerank(RerankProvider):
    """Keeps fusion order and normalizes scores into [0, 1]."""

    name = "none"
    model = "none"

    async def rerank(
        self, query: str, documents: Sequence[str], top_n: int
    ) -> list[RerankResult]:
        n = max(len(documents), 1)
        return [
            RerankResult(index=i, score=1.0 - (i / n)) for i in range(min(top_n, len(documents)))
        ]


def build_rerank_provider(llm: LLMProvider | None = None) -> RerankProvider:
    provider = settings.rerank_provider.lower()
    if not settings.rerank_enabled or provider == "none":
        return NoopRerank()
    if provider == "voyage":
        return VoyageRerank(settings.rerank_model, settings.voyage_api_key)
    if provider == "cohere":
        return CohereRerank(settings.rerank_model, settings.cohere_api_key)
    if provider == "llm":
        if llm is None:
            raise ProviderError("the llm reranker requires an LLM provider")
        return LLMRerank(llm)
    raise ProviderError(f"unknown rerank provider: {provider}")
