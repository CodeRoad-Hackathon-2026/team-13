"""Provider registry.

One lazily-built singleton per provider kind, shared by the API process and the
worker process. Everything downstream depends on the abstract interfaces in
``app.providers.base`` only.
"""

from __future__ import annotations

from app.config import settings
from app.providers.base import (
    EmbeddingProvider,
    LLMMessage,
    LLMProvider,
    LLMResponse,
    ProviderError,
    RerankProvider,
    RerankResult,
)
from app.providers.embeddings import build_embedding_provider
from app.providers.llm import build_llm_provider
from app.providers.rerank import build_rerank_provider

_embeddings: EmbeddingProvider | None = None
_llm: LLMProvider | None = None
_judge: LLMProvider | None = None
_rerank: RerankProvider | None = None


def embeddings() -> EmbeddingProvider:
    global _embeddings
    if _embeddings is None:
        _embeddings = build_embedding_provider()
    return _embeddings


def llm() -> LLMProvider:
    global _llm
    if _llm is None:
        _llm = build_llm_provider()
    return _llm


def judge() -> LLMProvider:
    """The groundedness judge. Same vendor, optionally a different model."""
    global _judge
    if _judge is None:
        model = settings.effective_judge_model
        _judge = llm() if model == settings.llm_model else build_llm_provider(model)
    return _judge


def reranker() -> RerankProvider:
    global _rerank
    if _rerank is None:
        _rerank = build_rerank_provider(llm() if settings.rerank_provider == "llm" else None)
    return _rerank


async def close_providers() -> None:
    global _embeddings, _llm, _judge, _rerank
    seen: set[int] = set()
    for provider in (_embeddings, _llm, _judge, _rerank):
        # judge() and reranker() may alias llm(); close each object once.
        if provider is not None and id(provider) not in seen:
            seen.add(id(provider))
            await provider.aclose()
    _embeddings = _llm = _judge = _rerank = None


__all__ = [
    "EmbeddingProvider",
    "LLMMessage",
    "LLMProvider",
    "LLMResponse",
    "ProviderError",
    "RerankProvider",
    "RerankResult",
    "close_providers",
    "embeddings",
    "judge",
    "llm",
    "reranker",
]
