"""Answer generation with the anti-hallucination guardrails.

Four independent layers, in order of how much they actually buy you:

1. Confidence threshold  — if nothing retrieved clears ``min_context_score``,
   the API abstains and never calls the model. Most hallucinations are just a
   model being asked a question the corpus cannot answer.
2. Citation validation   — every ``[n]`` in the answer is resolved back to a
   real chunk id. Numbers outside the provided range are stripped and reported,
   so a fabricated citation cannot reach the caller as a real source.
3. Groundedness judge    — a second model call checks each claim against the
   passages and returns a structured verdict.
4. Full trace + feedback — query, chunks, answer, and verdict are persisted so
   agents can mark what actually helped, which feeds back into ranking.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Sequence

from app import providers
from app.config import settings
from app.db import get_pool
from app.providers.base import LLMMessage, ProviderError
from app.rag import prompts
from app.rag.prompt_store import PromptSet, get_prompt_set
from app.retrieval.hybrid import Candidate, retrieve

logger = logging.getLogger(__name__)

_CITATION_RE = re.compile(r"\[(\d{1,2})\]")


def confidence_of(candidate: Candidate) -> float:
    """Absolute relevance in [0, 1] — the number the abstention gate reads.

    Deliberately *not* derived from the RRF score. RRF is rank-based, so the
    top hit of any search scores near the maximum no matter how irrelevant the
    corpus is; a threshold on it would never fire and the abstention guardrail
    would be decorative. Use a real similarity signal instead:

    * reranker score when available — a calibrated query/passage relevance;
    * else cosine similarity from the vector branch;
    * else the lexical rank score, for chunks only the text branch found.
    """
    if candidate.rerank_score is not None:
        return max(0.0, min(float(candidate.rerank_score), 1.0))
    if candidate.vector_score is not None:
        return max(0.0, min(float(candidate.vector_score), 1.0))
    if candidate.lexical_score is not None:
        return max(0.0, min(float(candidate.lexical_score), 1.0))
    return 0.0


def best_confidence(candidates: Sequence[Candidate]) -> float:
    """Highest confidence in the set.

    Candidates arrive ordered by fusion score, which is not the same ordering
    as absolute confidence — so the gate reads the best passage available, not
    whichever one fusion happened to rank first.
    """
    return max((confidence_of(c) for c in candidates), default=0.0)


@dataclass
class AnswerResult:
    query_log_id: str | None
    answer: str
    abstained: bool
    abstain_reason: str | None
    citations: list[dict] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    groundedness: dict | None = None
    confidence: float = 0.0
    model: str | None = None
    latency_ms: int = 0
    warnings: list[str] = field(default_factory=list)
    # Which prompt versions produced this answer. Returned to the caller so a
    # PR body can record it alongside the citations — an answer is only
    # reproducible if you know the prompt it came from.
    prompt_versions: dict = field(default_factory=dict)
    # Token cost, split by which model call incurred it. Generation and the
    # judge are separate calls on possibly different models, so a single total
    # would hide that the judge is the cheap half.
    usage: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "query_log_id": self.query_log_id,
            "answer": self.answer,
            "abstained": self.abstained,
            "abstain_reason": self.abstain_reason,
            "confidence": round(self.confidence, 4),
            "citations": self.citations,
            "sources": self.sources,
            "groundedness": self.groundedness,
            "model": self.model,
            "latency_ms": self.latency_ms,
            "warnings": self.warnings,
            "prompt_versions": self.prompt_versions,
            "usage": self.usage,
        }


def build_context(candidates: Sequence[Candidate]) -> str:
    """Render passages as a numbered list the model can cite by index."""
    blocks = []
    for i, candidate in enumerate(candidates, start=1):
        header_bits = [f"[{i}]"]
        if candidate.title:
            header_bits.append(candidate.title)
        header_bits.append(f"({candidate.collection}:{candidate.external_id})")
        if candidate.uri:
            header_bits.append(f"<{candidate.uri}>")
        blocks.append(f"{' '.join(header_bits)}\n{candidate.content}")
    return "\n\n".join(blocks)


def extract_citations(
    answer: str, candidates: Sequence[Candidate]
) -> tuple[list[dict], list[int]]:
    """Resolve ``[n]`` markers to chunks; report any that do not exist."""
    cited: list[dict] = []
    invalid: list[int] = []
    seen: set[int] = set()
    for match in _CITATION_RE.finditer(answer):
        index = int(match.group(1))
        if not 1 <= index <= len(candidates):
            if index not in invalid:
                invalid.append(index)
            continue
        if index in seen:
            continue
        seen.add(index)
        candidate = candidates[index - 1]
        cited.append(
            {
                "marker": index,
                "chunk_id": candidate.chunk_id,
                "document_id": candidate.document_id,
                "collection": candidate.collection,
                "external_id": candidate.external_id,
                "title": candidate.title,
                "uri": candidate.uri,
                "score": round(confidence_of(candidate), 4),
            }
        )
    return cited, invalid


def strip_invalid_citations(answer: str, valid_max: int) -> str:
    """Remove citation markers that point at nothing."""
    return _CITATION_RE.sub(
        lambda m: m.group(0) if 1 <= int(m.group(1)) <= valid_max else "", answer
    )


async def check_groundedness(
    answer: str, context: str, prompt_set: PromptSet | None = None
) -> dict | None:
    if not settings.groundedness_check or not answer.strip():
        return None
    prompt_set = prompt_set or await get_prompt_set()
    try:
        verdict = await providers.judge().structured(
            system=prompt_set.groundedness_system,
            messages=[
                LLMMessage(
                    role="user",
                    content=prompt_set.groundedness_template.format(
                        context=context, answer=answer
                    ),
                )
            ],
            schema=prompts.GROUNDEDNESS_SCHEMA,
            effort=settings.judge_effort,
        )
        verdict["score"] = float(verdict.get("score", 0.0))
        return verdict
    except Exception:  # noqa: BLE001
        # A judge failure must not fail the answer — report it instead.
        logger.exception("groundedness check failed")
        return {"score": None, "verdict": "unknown", "error": "judge unavailable"}


async def log_query(
    *,
    query: str,
    collections: Sequence[str] | None,
    filters: dict | None,
    candidates: Sequence[Candidate],
    result: AnswerResult,
    api_key_id: str | None,
    agent_id: str | None,
    incident_id: str | None,
) -> str | None:
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            return str(
                await conn.fetchval(
                    """
                    INSERT INTO query_logs (
                        api_key_id, agent_id, incident_id, query, collections, filters,
                        retrieved, answer, citations, abstained, abstain_reason,
                        groundedness, llm_model, embedding_model, latency_ms,
                        prompt_versions, usage
                    )
                    VALUES ($1, $2, $3, $4, $5::text[], $6::jsonb, $7::jsonb, $8,
                            $9::jsonb, $10, $11, $12::jsonb, $13, $14, $15, $16::jsonb,
                            $17::jsonb)
                    RETURNING id
                    """,
                    api_key_id,
                    agent_id,
                    incident_id,
                    query,
                    list(collections) if collections else [],
                    filters or {},
                    [c.to_dict() for c in candidates],
                    result.answer,
                    result.citations,
                    result.abstained,
                    result.abstain_reason,
                    result.groundedness,
                    result.model,
                    settings.embedding_model,
                    result.latency_ms,
                    result.prompt_versions,
                    result.usage,
                )
            )
    except Exception:  # noqa: BLE001
        logger.exception("failed to persist query log")
        return None


def _abstention(
    reason: str,
    candidates: Sequence[Candidate],
    started: float,
    prompt_set: PromptSet,
) -> AnswerResult:
    return AnswerResult(
        query_log_id=None,
        answer=prompt_set.abstain_message,
        abstained=True,
        abstain_reason=reason,
        sources=[c.to_dict() for c in candidates],
        confidence=best_confidence(candidates),
        latency_ms=int((time.perf_counter() - started) * 1000),
        prompt_versions=prompt_set.versions,
    )


def _scope(collections: Sequence[str] | None) -> str | None:
    """The collection whose prompt override applies, if any.

    Only a single-collection request has an unambiguous override. With two
    collections there is no principled winner, and picking one would make the
    same question answer differently depending on argument order.
    """
    return collections[0] if collections and len(collections) == 1 else None


async def answer_question(
    query: str,
    *,
    collections: Sequence[str] | None = None,
    filters: dict | None = None,
    top_k: int | None = None,
    api_key_id: str | None = None,
    agent_id: str | None = None,
    incident_id: str | None = None,
) -> AnswerResult:
    started = time.perf_counter()
    prompt_set = await get_prompt_set(_scope(collections))
    candidates = await retrieve(
        query, collections=collections, filters=filters, top_k=top_k
    )

    if not candidates:
        result = _abstention("no_results", candidates, started, prompt_set)
    elif best_confidence(candidates) < settings.min_context_score:
        result = _abstention("below_confidence_threshold", candidates, started, prompt_set)
    else:
        context = build_context(candidates)
        try:
            response = await providers.llm().complete(
                system=prompt_set.answer_system,
                messages=[
                    LLMMessage(
                        role="user",
                        content=prompt_set.answer_template.format(
                            context=context, question=query
                        ),
                    )
                ],
                max_tokens=settings.llm_max_tokens,
            )
        except ProviderError as exc:
            result = _abstention(f"llm_error: {exc}", candidates, started, prompt_set)
            result.answer = f"Generation failed: {exc}"
        else:
            if response.refusal:
                result = _abstention("model_refusal", candidates, started, prompt_set)
            else:
                result = await _finalize(
                    response.text, response.model, candidates, context, started,
                    prompt_set, response.usage,
                )

    result.query_log_id = await log_query(
        query=query,
        collections=collections,
        filters=filters,
        candidates=candidates,
        result=result,
        api_key_id=api_key_id,
        agent_id=agent_id,
        incident_id=incident_id,
    )
    return result


async def _finalize(
    text: str,
    model: str,
    candidates: Sequence[Candidate],
    context: str,
    started: float,
    prompt_set: PromptSet,
    generation_usage: dict | None = None,
) -> AnswerResult:
    citations, invalid = extract_citations(text, candidates)
    warnings: list[str] = []
    if invalid:
        # A citation to a passage that was never supplied is a fabricated
        # source. Strip it rather than let a caller resolve it downstream.
        warnings.append(f"removed invalid citation markers: {invalid}")
        text = strip_invalid_citations(text, len(candidates))
    if settings.require_citations and not citations:
        warnings.append("answer contains no citations")

    groundedness = await check_groundedness(text, context, prompt_set)
    # Popped so the verdict returned to callers stays the judge's actual
    # opinion, with the cost recorded alongside it rather than inside it.
    judge_usage = (groundedness or {}).pop("_usage", None)
    if (
        groundedness
        and isinstance(groundedness.get("score"), (int, float))
        and groundedness["score"] < settings.min_groundedness_score
    ):
        warnings.append(
            f"groundedness score {groundedness['score']:.2f} is below the "
            f"{settings.min_groundedness_score} threshold"
        )

    return AnswerResult(
        query_log_id=None,
        answer=text.strip(),
        abstained=False,
        abstain_reason=None,
        citations=citations,
        sources=[c.to_dict() for c in candidates],
        groundedness=groundedness,
        confidence=best_confidence(candidates),
        model=model,
        latency_ms=int((time.perf_counter() - started) * 1000),
        warnings=warnings,
        prompt_versions=prompt_set.versions,
        usage={
            k: v for k, v in
            {"generation": generation_usage, "judge": judge_usage}.items() if v
        },
    )


async def stream_answer(
    query: str,
    *,
    collections: Sequence[str] | None = None,
    filters: dict | None = None,
    top_k: int | None = None,
    api_key_id: str | None = None,
    agent_id: str | None = None,
    incident_id: str | None = None,
) -> AsyncIterator[dict]:
    """Yield SSE payloads: sources → deltas → final verdict.

    Sources are emitted before the first token so a UI can render citations
    while the answer streams, and so a caller can abort early if the retrieved
    passages are obviously wrong.
    """
    started = time.perf_counter()
    prompt_set = await get_prompt_set(_scope(collections))
    candidates = await retrieve(
        query, collections=collections, filters=filters, top_k=top_k
    )
    yield {"event": "sources", "data": {"sources": [c.to_dict() for c in candidates]}}

    if not candidates or best_confidence(candidates) < settings.min_context_score:
        reason = "no_results" if not candidates else "below_confidence_threshold"
        result = _abstention(reason, candidates, started, prompt_set)
        result.query_log_id = await log_query(
            query=query,
            collections=collections,
            filters=filters,
            candidates=candidates,
            result=result,
            api_key_id=api_key_id,
            agent_id=agent_id,
            incident_id=incident_id,
        )
        yield {"event": "abstained", "data": result.to_dict()}
        yield {"event": "done", "data": {"query_log_id": result.query_log_id}}
        return

    context = build_context(candidates)
    chunks: list[str] = []
    try:
        async for delta in providers.llm().stream(
            system=prompt_set.answer_system,
            messages=[
                LLMMessage(
                    role="user",
                    content=prompt_set.answer_template.format(
                        context=context, question=query
                    ),
                )
            ],
            max_tokens=settings.llm_max_tokens,
        ):
            chunks.append(delta)
            yield {"event": "delta", "data": {"text": delta}}
    except (ProviderError, asyncio.CancelledError) as exc:
        yield {"event": "error", "data": {"message": str(exc)}}
        return

    # Validation runs on the assembled answer, after streaming: the caller has
    # already seen the raw text, so the final event is what they must trust.
    # No usage on the streaming path: stream() yields text deltas, so the
    # provider's token counts are never surfaced. Callers that need cost
    # attribution should use POST /answer.
    result = await _finalize(
        "".join(chunks), providers.llm().model, candidates, context, started, prompt_set
    )
    result.query_log_id = await log_query(
        query=query,
        collections=collections,
        filters=filters,
        candidates=candidates,
        result=result,
        api_key_id=api_key_id,
        agent_id=agent_id,
        incident_id=incident_id,
    )
    yield {"event": "final", "data": result.to_dict()}
    yield {"event": "done", "data": {"query_log_id": result.query_log_id}}
