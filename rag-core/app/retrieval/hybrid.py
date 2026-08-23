"""Hybrid retrieval: pgvector ANN + Postgres full-text, fused with RRF.

Why both branches: incident questions mix fuzzy description ("checkout is
timing out after the deploy") with exact tokens (`ERR_CONN_RESET`,
`payments-svc`, `ORA-01555`, a commit SHA). Dense vectors handle the first and
are unreliable on the second; BM25-style lexical search is the reverse.

Reciprocal Rank Fusion combines them without needing the two score scales to be
comparable — it only reads each branch's *rank*, which is what makes it robust
when one branch returns cosine distances and the other returns ts_rank_cd.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Sequence

from app import providers
from app.config import settings
from app.db import get_pool, to_pgvector

logger = logging.getLogger(__name__)

_SEARCH_SQL = """
WITH target AS (
    SELECT id FROM collections
    WHERE $2::text[] IS NULL OR name = ANY($2::text[])
),
vector_hits AS (
    SELECT c.id AS chunk_id,
           ROW_NUMBER() OVER (ORDER BY c.embedding <=> $1::vector) AS rank,
           1 - (c.embedding <=> $1::vector) AS score
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.collection_id IN (SELECT id FROM target)
      AND d.deleted_at IS NULL
      AND c.metadata @> $3::jsonb
    ORDER BY c.embedding <=> $1::vector
    LIMIT $4
),
lexical_hits AS (
    SELECT c.id AS chunk_id,
           ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv, q.query) DESC) AS rank,
           ts_rank_cd(c.tsv, q.query) AS score
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    -- OR over the query's lexemes, not AND.
    --
    -- websearch_to_tsquery/plainto_tsquery AND every term, so a single word
    -- absent from a chunk excludes it entirely: asking "checkout timing out
    -- ERR_UPSTREAM_TIMEOUT pgbouncer" matches nothing even though the runbook
    -- names pgbouncer. That silently reduces hybrid search to vector-only.
    -- OR-ing keeps recall and lets ts_rank_cd (which rewards matching more
    -- terms, closer together) do the discriminating — which is exactly the
    -- signal RRF expects from this branch.
    --
    -- quote_literal() per lexeme so tokens containing punctuation cannot break
    -- the tsquery parser. Double cast on the config: asyncpg has no regconfig
    -- codec, so it is sent as text and cast server-side.
    CROSS JOIN (
        SELECT COALESCE(
            (SELECT string_agg(quote_literal(lexeme), ' | ')
             FROM unnest(tsvector_to_array(to_tsvector($6::text::regconfig, $5))) AS lexeme),
            ''
        )::tsquery AS query
    ) q
    WHERE c.collection_id IN (SELECT id FROM target)
      AND d.deleted_at IS NULL
      AND c.metadata @> $3::jsonb
      AND c.tsv @@ q.query
    ORDER BY ts_rank_cd(c.tsv, q.query) DESC
    LIMIT $4
),
fused AS (
    SELECT chunk_id,
           COALESCE($7::float / ($9::float + v.rank), 0.0)
         + COALESCE($8::float / ($9::float + l.rank), 0.0) AS rrf_score,
           v.score AS vector_score,
           l.score AS lexical_score,
           v.rank  AS vector_rank,
           l.rank  AS lexical_rank
    FROM vector_hits v
    FULL OUTER JOIN lexical_hits l USING (chunk_id)
)
SELECT f.chunk_id,
       f.rrf_score,
       f.vector_score,
       f.lexical_score,
       f.vector_rank,
       f.lexical_rank,
       -- Feedback is a multiplicative nudge, not an additive term: RRF scores
       -- live around 0.03, so an additive bonus would swamp the ranking.
       f.rrf_score * (1.0 + $10::float * COALESCE(fb.avg_rating, 0.0)) AS final_score,
       COALESCE(fb.avg_rating, 0.0) AS feedback_score,
       COALESCE(fb.vote_count, 0)   AS feedback_votes,
       c.content,
       c.context,
       c.metadata,
       c.ordinal,
       d.id    AS document_id,
       d.title,
       d.uri,
       d.external_id,
       d.source_type,
       d.source_updated_at,
       col.name AS collection
FROM fused f
JOIN chunks c      ON c.id = f.chunk_id
JOIN documents d   ON d.id = c.document_id
JOIN collections col ON col.id = c.collection_id
LEFT JOIN chunk_feedback_scores fb ON fb.chunk_id = f.chunk_id
ORDER BY final_score DESC
LIMIT $11
"""


@dataclass
class Candidate:
    chunk_id: str
    document_id: str
    collection: str
    content: str
    context: str | None
    title: str | None
    uri: str | None
    external_id: str
    source_type: str
    metadata: dict = field(default_factory=dict)
    vector_score: float | None = None
    lexical_score: float | None = None
    vector_rank: int | None = None
    lexical_rank: int | None = None
    rrf_score: float = 0.0
    feedback_score: float = 0.0
    feedback_votes: int = 0
    rerank_score: float | None = None

    @property
    def score(self) -> float:
        """The score callers rank on: reranker if present, else fusion."""
        return self.rerank_score if self.rerank_score is not None else self.rrf_score

    @property
    def retrieval_mode(self) -> str:
        if self.vector_rank is not None and self.lexical_rank is not None:
            return "hybrid"
        return "vector" if self.vector_rank is not None else "lexical"

    def to_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "collection": self.collection,
            "external_id": self.external_id,
            "title": self.title,
            "uri": self.uri,
            "source_type": self.source_type,
            "content": self.content,
            "metadata": self.metadata,
            "score": round(self.score, 6),
            "scores": {
                "vector": self.vector_score,
                "lexical": self.lexical_score,
                "rrf": round(self.rrf_score, 6),
                "rerank": self.rerank_score,
                "feedback": self.feedback_score,
            },
            "retrieval_mode": self.retrieval_mode,
        }


async def hybrid_search(
    query: str,
    *,
    collections: Sequence[str] | None = None,
    filters: dict | None = None,
    candidates: int | None = None,
    limit: int | None = None,
) -> list[Candidate]:
    candidates = candidates or settings.retrieval_candidates
    limit = limit or settings.rerank_candidates

    embedding = await providers.embeddings().embed_one(query, input_type="query")

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _SEARCH_SQL,
            to_pgvector(embedding),                 # $1
            list(collections) if collections else None,  # $2
            filters or {},                          # $3
            candidates,                             # $4
            query,                                  # $5
            settings.fts_config,                    # $6
            settings.vector_weight,                 # $7
            settings.lexical_weight,                # $8
            settings.rrf_k,                         # $9
            settings.feedback_weight,               # $10
            limit,                                  # $11
        )

    return [
        Candidate(
            chunk_id=str(r["chunk_id"]),
            document_id=str(r["document_id"]),
            collection=r["collection"],
            content=r["content"],
            context=r["context"],
            title=r["title"],
            uri=r["uri"],
            external_id=r["external_id"],
            source_type=r["source_type"],
            metadata=r["metadata"] or {},
            vector_score=r["vector_score"],
            lexical_score=r["lexical_score"],
            vector_rank=r["vector_rank"],
            lexical_rank=r["lexical_rank"],
            rrf_score=r["rrf_score"] or 0.0,
            feedback_score=r["feedback_score"] or 0.0,
            feedback_votes=r["feedback_votes"] or 0,
        )
        for r in rows
    ]


async def rerank_candidates(
    query: str, candidates: list[Candidate], top_k: int
) -> list[Candidate]:
    """Cross-encode the fused candidates and keep the best ``top_k``."""
    if not candidates:
        return []
    if not settings.rerank_enabled:
        return candidates[:top_k]

    try:
        results = await providers.reranker().rerank(
            query, [c.content for c in candidates], top_n=top_k
        )
    except Exception:  # noqa: BLE001
        # A reranker outage degrades ranking quality; it must not take down
        # retrieval, so fall back to fusion order.
        logger.exception("reranker failed; falling back to fusion order")
        return candidates[:top_k]

    ranked: list[Candidate] = []
    for result in results:
        if 0 <= result.index < len(candidates):
            candidate = candidates[result.index]
            candidate.rerank_score = result.score
            ranked.append(candidate)
    return ranked[:top_k]


async def retrieve(
    query: str,
    *,
    collections: Sequence[str] | None = None,
    filters: dict | None = None,
    top_k: int | None = None,
) -> list[Candidate]:
    """Full retrieval path: hybrid fusion → rerank → top_k."""
    top_k = top_k or settings.retrieval_top_k
    fused = await hybrid_search(query, collections=collections, filters=filters)
    return await rerank_candidates(query, fused, top_k)
