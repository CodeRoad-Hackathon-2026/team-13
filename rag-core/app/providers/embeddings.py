"""Embedding adapters. Selected by ``EMBEDDING_PROVIDER``."""

from __future__ import annotations

import asyncio
import hashlib
import struct
from typing import Literal, Sequence

import httpx

from app.config import settings
from app.providers.base import EmbeddingProvider, ProviderError


def _batched(items: Sequence[str], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


class VoyageEmbeddings(EmbeddingProvider):
    """Voyage AI — the recommended pairing with Claude for retrieval."""

    name = "voyage"

    def __init__(self, model: str, dimension: int, api_key: str | None):
        if not api_key:
            raise ProviderError("VOYAGE_API_KEY is required for the voyage provider")
        self.model = model
        self.dimension = dimension
        self._client = httpx.AsyncClient(
            base_url="https://api.voyageai.com/v1",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=settings.request_timeout_seconds,
        )

    async def embed(
        self,
        texts: Sequence[str],
        input_type: Literal["document", "query"] = "document",
    ) -> list[list[float]]:
        out: list[list[float]] = []
        for batch in _batched(list(texts), settings.embedding_batch_size):
            resp = await self._client.post(
                "/embeddings",
                json={
                    "input": list(batch),
                    "model": self.model,
                    "input_type": input_type,
                    "output_dimension": self.dimension,
                },
            )
            if resp.status_code >= 400:
                raise ProviderError(f"voyage embeddings failed: {resp.text}")
            data = resp.json()["data"]
            out.extend(item["embedding"] for item in sorted(data, key=lambda d: d["index"]))
        return out

    async def aclose(self) -> None:
        await self._client.aclose()


class OpenAIEmbeddings(EmbeddingProvider):
    name = "openai"

    def __init__(self, model: str, dimension: int, api_key: str | None):
        if not api_key:
            raise ProviderError("OPENAI_API_KEY is required for the openai provider")
        self.model = model
        self.dimension = dimension
        self._client = httpx.AsyncClient(
            base_url="https://api.openai.com/v1",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=settings.request_timeout_seconds,
        )

    async def embed(
        self,
        texts: Sequence[str],
        input_type: Literal["document", "query"] = "document",
    ) -> list[list[float]]:
        # OpenAI embeddings are symmetric; input_type is intentionally ignored.
        out: list[list[float]] = []
        for batch in _batched(list(texts), settings.embedding_batch_size):
            resp = await self._client.post(
                "/embeddings",
                json={
                    "input": list(batch),
                    "model": self.model,
                    "dimensions": self.dimension,
                },
            )
            if resp.status_code >= 400:
                raise ProviderError(f"openai embeddings failed: {resp.text}")
            data = resp.json()["data"]
            out.extend(item["embedding"] for item in sorted(data, key=lambda d: d["index"]))
        return out

    async def aclose(self) -> None:
        await self._client.aclose()


class OllamaEmbeddings(EmbeddingProvider):
    """Local models via Ollama — no token, no egress."""

    name = "ollama"

    def __init__(self, model: str, dimension: int, base_url: str):
        self.model = model
        self.dimension = dimension
        self._client = httpx.AsyncClient(
            base_url=base_url, timeout=settings.request_timeout_seconds
        )

    async def embed(
        self,
        texts: Sequence[str],
        input_type: Literal["document", "query"] = "document",
    ) -> list[list[float]]:
        resp = await self._client.post(
            "/api/embed", json={"model": self.model, "input": list(texts)}
        )
        if resp.status_code >= 400:
            raise ProviderError(f"ollama embeddings failed: {resp.text}")
        return resp.json()["embeddings"]

    async def aclose(self) -> None:
        await self._client.aclose()


class HashEmbeddings(EmbeddingProvider):
    """Deterministic offline embeddings.

    Not semantically useful — it exists so the full pipeline (ingest, index,
    hybrid search, RRF, API) can be exercised in tests and offline demos
    without any API key. Never enable it in production.
    """

    name = "hash"

    def __init__(self, dimension: int):
        self.model = "hash-local"
        self.dimension = dimension

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * self.dimension
        for token in text.lower().split():
            digest = hashlib.sha256(token.encode()).digest()
            for i in range(0, 32, 4):
                slot = struct.unpack("<I", digest[i : i + 4])[0] % self.dimension
                vec[slot] += 1.0
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        return [v / norm for v in vec]

    async def embed(
        self,
        texts: Sequence[str],
        input_type: Literal["document", "query"] = "document",
    ) -> list[list[float]]:
        await asyncio.sleep(0)
        return [self._vector(t) for t in texts]


def build_embedding_provider() -> EmbeddingProvider:
    provider = settings.embedding_provider.lower()
    if provider == "voyage":
        return VoyageEmbeddings(
            settings.embedding_model, settings.embedding_dim, settings.voyage_api_key
        )
    if provider == "openai":
        return OpenAIEmbeddings(
            settings.embedding_model, settings.embedding_dim, settings.openai_api_key
        )
    if provider == "ollama":
        return OllamaEmbeddings(
            settings.embedding_model, settings.embedding_dim, settings.ollama_base_url
        )
    if provider == "hash":
        return HashEmbeddings(settings.embedding_dim)
    raise ProviderError(f"unknown embedding provider: {provider}")
