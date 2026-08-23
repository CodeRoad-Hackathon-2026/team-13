"""Provider contracts.

Every external model call in the system goes through one of these three
interfaces. Swapping vendors is a config change (provider name + token), never
a code change in the retrieval or API layers.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import AsyncIterator, Literal, Sequence


class ProviderError(RuntimeError):
    """Raised when an upstream provider fails in a way the caller should see."""


# --------------------------------------------------------------- embeddings
class EmbeddingProvider(abc.ABC):
    """Turns text into vectors.

    ``input_type`` matters for asymmetric models (Voyage, Cohere): the same
    text embeds differently as a stored document than as a search query, and
    using the wrong one measurably degrades recall.
    """

    name: str
    model: str
    dimension: int

    @abc.abstractmethod
    async def embed(
        self,
        texts: Sequence[str],
        input_type: Literal["document", "query"] = "document",
    ) -> list[list[float]]: ...

    async def embed_one(
        self, text: str, input_type: Literal["document", "query"] = "query"
    ) -> list[float]:
        return (await self.embed([text], input_type=input_type))[0]

    async def aclose(self) -> None:  # pragma: no cover - trivial
        return None


# ---------------------------------------------------------------------- llm
@dataclass
class LLMMessage:
    role: Literal["user", "assistant"]
    content: str


@dataclass
class LLMResponse:
    text: str
    model: str
    usage: dict = field(default_factory=dict)
    stop_reason: str | None = None
    refusal: bool = False


class LLMProvider(abc.ABC):
    name: str
    model: str

    @abc.abstractmethod
    async def complete(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None = None,
    ) -> LLMResponse: ...

    @abc.abstractmethod
    def stream(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None = None,
    ) -> AsyncIterator[str]:
        """Yield text deltas. Implementations are async generators."""

    @abc.abstractmethod
    async def structured(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        schema: dict,
        max_tokens: int = 2048,
        effort: str | None = None,
    ) -> dict:
        """Return an object validated against ``schema``.

        Used by the groundedness judge, where a free-text verdict would need
        parsing and could itself hallucinate a format.
        """

    async def aclose(self) -> None:  # pragma: no cover - trivial
        return None


# ------------------------------------------------------------------ rerank
@dataclass
class RerankResult:
    index: int
    score: float


class RerankProvider(abc.ABC):
    name: str
    model: str

    @abc.abstractmethod
    async def rerank(
        self, query: str, documents: Sequence[str], top_n: int
    ) -> list[RerankResult]: ...

    async def aclose(self) -> None:  # pragma: no cover - trivial
        return None
