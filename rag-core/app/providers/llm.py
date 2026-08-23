"""LLM adapters. Selected by ``LLM_PROVIDER``."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator, Sequence

import httpx

from app.config import settings
from app.providers.base import LLMMessage, LLMProvider, LLMResponse, ProviderError

logger = logging.getLogger(__name__)

# Opting into server-side fallbacks by default: Claude Opus 5's safety
# classifiers can decline a request (HTTP 200 + stop_reason "refusal"), and
# incident data — security tooling, exploit traces, log dumps — sits close
# enough to those categories to trip a false positive. With this on, the API
# re-serves the declined request on the recommended fallback model inside the
# same call instead of handing us an empty answer mid-incident.
_FALLBACK_BETA = "server-side-fallback-2026-07-01"


def _to_anthropic_messages(messages: Sequence[LLMMessage]) -> list[dict]:
    return [{"role": m.role, "content": m.content} for m in messages]


class AnthropicLLM(LLMProvider):
    name = "anthropic"

    def __init__(self, model: str, api_key: str | None, server_side_fallback: bool = True):
        try:
            from anthropic import AsyncAnthropic
        except ImportError as exc:  # pragma: no cover
            raise ProviderError("the `anthropic` package is not installed") from exc
        # A bare AsyncAnthropic() also resolves an `ant auth login` profile, so
        # a missing env var is not necessarily a missing credential.
        self._client = AsyncAnthropic(api_key=api_key) if api_key else AsyncAnthropic()
        self.model = model
        self._fallback = server_side_fallback

    def _extra(self, effort: str | None, schema: dict | None = None) -> dict:
        output_config: dict = {}
        if effort:
            output_config["effort"] = effort
        if schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": schema}
        extra: dict = {}
        if output_config:
            extra["output_config"] = output_config
        if self._fallback:
            # Sent through extra_body/extra_headers rather than as typed
            # kwargs: `fallbacks` is newer than some pinned SDK versions, and a
            # TypeError at call time would take down every request.
            extra["extra_body"] = {"fallbacks": "default"}
            extra["extra_headers"] = {"anthropic-beta": _FALLBACK_BETA}
        return extra

    def _api(self):
        return self._client.messages

    def _degrade(self, exc: Exception) -> bool:
        """Disable server-side fallbacks once if the endpoint rejects them.

        Better to lose the refusal-rescue than to fail every generation on a
        deployment (Bedrock, Vertex, an older SDK) that does not accept the
        parameter. Narrowly scoped: an unrelated TypeError — a missing API key,
        for instance — must not silently turn the feature off.
        """
        if not self._fallback or "fallback" not in str(exc).lower():
            return False
        logger.warning("disabling server-side fallbacks after upstream rejection: %s", exc)
        self._fallback = False
        return True

    async def _create(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None,
        schema: dict | None = None,
    ):
        """Single call site for retry-on-degrade and error normalization."""
        base = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": _to_anthropic_messages(messages),
        }
        try:
            return await self._api().create(**base, **self._extra(effort, schema))
        except TypeError as exc:
            if self._degrade(exc):
                return await self._api().create(**base, **self._extra(effort, schema))
            # The SDK raises TypeError for unresolvable credentials. That is an
            # upstream configuration problem — a 502, not an unhandled crash.
            raise ProviderError(f"anthropic client error: {exc}") from exc

    async def complete(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None = None,
    ) -> LLMResponse:
        resp = await self._create(
            system=system, messages=messages, max_tokens=max_tokens, effort=effort
        )
        # Always branch on stop_reason before touching content: on a refusal the
        # content array is empty or partial and content[0] would raise.
        if resp.stop_reason == "refusal":
            return LLMResponse(
                text="", model=resp.model, refusal=True, stop_reason="refusal"
            )
        text = "".join(b.text for b in resp.content if b.type == "text")
        return LLMResponse(
            text=text,
            model=resp.model,
            stop_reason=resp.stop_reason,
            usage={
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        )

    async def stream(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None = None,
    ) -> AsyncIterator[str]:
        try:
            manager = self._api().stream(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=_to_anthropic_messages(messages),
                **self._extra(effort),
            )
        except TypeError as exc:
            if not self._degrade(exc):
                raise ProviderError(f"anthropic client error: {exc}") from exc
            manager = self._api().stream(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=_to_anthropic_messages(messages),
                **self._extra(effort),
            )

        async with manager as stream:
            async for event in stream:
                if (
                    event.type == "content_block_delta"
                    and event.delta.type == "text_delta"
                ):
                    yield event.delta.text
            final = await stream.get_final_message()
            if final.stop_reason == "refusal":
                raise ProviderError("the model declined to answer this request")

    async def structured(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        schema: dict,
        max_tokens: int = 2048,
        effort: str | None = None,
    ) -> dict:
        resp = await self._create(
            system=system,
            messages=messages,
            max_tokens=max_tokens,
            effort=effort,
            schema=schema,
        )
        if resp.stop_reason == "refusal":
            raise ProviderError("the model declined the structured request")
        text = "".join(b.text for b in resp.content if b.type == "text")
        verdict = json.loads(text)
        # Attached rather than returned separately so the interface stays a
        # plain dict. Callers that do not care simply never read the key.
        verdict["_usage"] = {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
            "model": self.model,
        }
        return verdict

    async def aclose(self) -> None:
        await self._client.close()


class OpenAILLM(LLMProvider):
    name = "openai"

    def __init__(self, model: str, api_key: str | None):
        if not api_key:
            raise ProviderError("OPENAI_API_KEY is required for the openai provider")
        self.model = model
        self._client = httpx.AsyncClient(
            base_url="https://api.openai.com/v1",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=settings.request_timeout_seconds,
        )

    def _payload(self, system: str, messages: Sequence[LLMMessage], max_tokens: int) -> dict:
        return {
            "model": self.model,
            "max_completion_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}]
            + [{"role": m.role, "content": m.content} for m in messages],
        }

    async def complete(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None = None,
    ) -> LLMResponse:
        resp = await self._client.post(
            "/chat/completions", json=self._payload(system, messages, max_tokens)
        )
        if resp.status_code >= 400:
            raise ProviderError(f"openai completion failed: {resp.text}")
        data = resp.json()
        return LLMResponse(
            text=data["choices"][0]["message"]["content"] or "",
            model=data.get("model", self.model),
            usage=data.get("usage", {}),
            stop_reason=data["choices"][0].get("finish_reason"),
        )

    async def stream(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None = None,
    ) -> AsyncIterator[str]:
        payload = self._payload(system, messages, max_tokens) | {"stream": True}
        async with self._client.stream("POST", "/chat/completions", json=payload) as resp:
            if resp.status_code >= 400:
                raise ProviderError(f"openai stream failed: {await resp.aread()!r}")
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                blob = line[6:].strip()
                if blob == "[DONE]":
                    break
                delta = json.loads(blob)["choices"][0].get("delta", {})
                if delta.get("content"):
                    yield delta["content"]

    async def structured(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        schema: dict,
        max_tokens: int = 2048,
        effort: str | None = None,
    ) -> dict:
        payload = self._payload(system, messages, max_tokens) | {
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "verdict", "schema": schema, "strict": True},
            }
        }
        resp = await self._client.post("/chat/completions", json=payload)
        if resp.status_code >= 400:
            raise ProviderError(f"openai structured call failed: {resp.text}")
        data = resp.json()
        verdict = json.loads(data["choices"][0]["message"]["content"])
        verdict["_usage"] = {**(data.get("usage") or {}), "model": self.model}
        return verdict

    async def aclose(self) -> None:
        await self._client.aclose()


class OllamaLLM(LLMProvider):
    name = "ollama"

    def __init__(self, model: str, base_url: str):
        self.model = model
        self._client = httpx.AsyncClient(
            base_url=base_url, timeout=settings.request_timeout_seconds
        )

    def _payload(self, system: str, messages: Sequence[LLMMessage]) -> dict:
        return {
            "model": self.model,
            "messages": [{"role": "system", "content": system}]
            + [{"role": m.role, "content": m.content} for m in messages],
        }

    async def complete(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None = None,
    ) -> LLMResponse:
        resp = await self._client.post(
            "/api/chat", json=self._payload(system, messages) | {"stream": False}
        )
        if resp.status_code >= 400:
            raise ProviderError(f"ollama chat failed: {resp.text}")
        data = resp.json()
        return LLMResponse(text=data["message"]["content"], model=self.model)

    async def stream(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        max_tokens: int,
        effort: str | None = None,
    ) -> AsyncIterator[str]:
        payload = self._payload(system, messages) | {"stream": True}
        async with self._client.stream("POST", "/api/chat", json=payload) as resp:
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                chunk = json.loads(line)
                if chunk.get("message", {}).get("content"):
                    yield chunk["message"]["content"]

    async def structured(
        self,
        *,
        system: str,
        messages: Sequence[LLMMessage],
        schema: dict,
        max_tokens: int = 2048,
        effort: str | None = None,
    ) -> dict:
        payload = self._payload(system, messages) | {"stream": False, "format": schema}
        resp = await self._client.post("/api/chat", json=payload)
        if resp.status_code >= 400:
            raise ProviderError(f"ollama structured call failed: {resp.text}")
        data = resp.json()
        verdict = json.loads(data["message"]["content"])
        verdict["_usage"] = {"model": self.model}
        return verdict

    async def aclose(self) -> None:
        await self._client.aclose()


def build_llm_provider(model: str | None = None) -> LLMProvider:
    provider = settings.llm_provider.lower()
    model = model or settings.llm_model
    if provider == "anthropic":
        return AnthropicLLM(model, settings.anthropic_api_key)
    if provider == "openai":
        return OpenAILLM(model, settings.openai_api_key)
    if provider == "ollama":
        return OllamaLLM(model, settings.ollama_base_url)
    raise ProviderError(f"unknown llm provider: {provider}")
