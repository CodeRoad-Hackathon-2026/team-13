"""RAG Retrieval Agent — finds the incidents, runbooks and postmortems that look
like this one, and records them as `similarity_matches`.

Calls /v1/search rather than /v1/answer on purpose: this step wants evidence to
reason over, not prose, and search spends no LLM tokens.
"""

from __future__ import annotations

import logging
from typing import Any, ClassVar

import asyncpg

from app.agents import events
from app.agents.base import Agent, AgentFailed, AgentResult, to_numeric
from app.config import settings
from app.rag_client import RagClient, RagError

logger = logging.getLogger(__name__)


def similarity_of(hit: dict[str, Any]) -> float:
    """The hit's similarity, not its rank.

    `score` is RRF — a reciprocal-rank fusion value used to order results. It
    lives around 0.03 regardless of how close anything actually is, so treating
    it as a similarity makes every threshold meaningless and is_known_incident
    permanently false.

    The comparable signal is under `scores`: the cross-encoder's relevance when
    reranking is on, otherwise the raw cosine similarity. Both are 0..1.
    """
    scores = hit.get("scores") or {}
    for key in ("rerank", "vector"):
        value = scores.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    # Nothing comparable was reported. Falling back to the fused score is wrong
    # in scale but still monotonic, and better than claiming a similarity of 0.
    return float(hit.get("score") or 0.0)


def build_query(incident: asyncpg.Record) -> str:
    """Title first, then the description.

    Deliberately not the whole record: category and environment are filters, not
    search terms, and folding them into the query dilutes the embedding.
    """
    parts = [incident["title"]]
    description = incident["description"]
    if description:
        parts.append(description)
    return "\n\n".join(part.strip() for part in parts if part and part.strip())


class RagRetrievalAgent(Agent):
    name: ClassVar[str] = "RAG Retrieval Agent"

    def __init__(self, rag: RagClient) -> None:
        self._rag = rag

    def describe_input(self, incident: asyncpg.Record) -> dict[str, Any]:
        return {
            "incident_id": str(incident["id"]),
            "query": build_query(incident),
            "top_k": settings.retrieval_top_k,
            "collections": settings.rag_collections,
        }

    async def handle(
        self, conn: asyncpg.Connection, incident: asyncpg.Record, run_id: str
    ) -> AgentResult:
        incident_id = str(incident["id"])
        query = build_query(incident)

        await events.record_event(
            conn,
            incident_id,
            events.RAG_SEARCH_STARTED,
            f"Searching the knowledge base for incidents like {incident['title']!r}",
            payload={"top_k": settings.retrieval_top_k},
            created_by=self.name,
        )

        try:
            response = await self._rag.search(query)
        except RagError as exc:
            raise AgentFailed(f"retrieval failed: {exc}") from exc

        hits: list[dict[str, Any]] = response.get("results", [])
        matched, unmatched = await self._record_matches(conn, incident_id, hits)

        best_score = matched[0]["score"] if matched else 0.0
        is_known = best_score >= settings.known_incident_threshold

        await conn.execute(
            """
            UPDATE incidents
               SET is_known_incident = $2,
                   confidence_score  = $3
             WHERE id = $1
            """,
            incident_id,
            is_known,
            to_numeric(best_score, 4),
        )

        await events.record_event(
            conn,
            incident_id,
            events.RAG_SEARCH_COMPLETED,
            f"{len(matched)} of {len(hits)} results linked to known documents"
            + (f" · best match {best_score:.2f}" if matched else ""),
            payload={"took_ms": response.get("took_ms"), "unlinked": len(unmatched)},
            created_by=self.name,
        )

        if is_known:
            top = matched[0]
            await events.record_event(
                conn,
                incident_id,
                events.SIMILAR_INCIDENT_FOUND,
                f"{top['title']} matched at {top['score']:.2f} — marked as a known incident",
                payload={"knowledge_document_id": top["knowledge_document_id"]},
                created_by=self.name,
            )

        return AgentResult(
            output={
                "hits": len(hits),
                "linked": len(matched),
                # Named, not counted: a hit RAG Core can retrieve but this database
                # cannot name is a corpus drift worth seeing, not a silent drop.
                "unlinked_external_ids": unmatched,
                "best_score": round(best_score, 4),
                "is_known_incident": is_known,
                "matches": matched,
            },
            confidence=best_score,
        )

    async def _record_matches(
        self, conn: asyncpg.Connection, incident_id: str, hits: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """Turn RAG Core hits into similarity_matches rows.

        similarity_matches.knowledge_document_id is a real foreign key, so a hit
        can only be recorded if this database already knows the document. Hits it
        cannot resolve are returned rather than inserted — inventing a
        knowledge_documents row to satisfy the constraint would fabricate a
        source the operator could then click through to.
        """
        matched: list[dict[str, Any]] = []
        unmatched: list[str] = []
        seen: set[str] = set()

        for hit in hits:
            external_id = str(hit.get("external_id") or "").strip()
            if not external_id:
                continue

            document = await self._resolve_document(conn, external_id)
            if document is None:
                unmatched.append(external_id)
                continue

            document_id = str(document["id"])
            # One row per document per run: RAG Core returns chunks, and several
            # chunks of the same runbook are one match, at its best chunk's score.
            if document_id in seen:
                continue
            seen.add(document_id)

            score = similarity_of(hit)
            await conn.execute(
                """
                INSERT INTO similarity_matches
                    (incident_id, knowledge_document_id, similarity_score, match_type)
                VALUES ($1, $2, $3, 'SEMANTIC')
                """,
                incident_id,
                document_id,
                to_numeric(score, 5),
            )
            matched.append(
                {
                    "knowledge_document_id": document_id,
                    "title": document["title"],
                    "document_type": document["document_type"],
                    "score": min(1.0, max(0.0, score)),
                    # Kept alongside so a reader can see how RAG Core ranked it,
                    # which is a different question from how close it is.
                    "rank_score": float(hit.get("score") or 0.0),
                }
            )

        matched.sort(key=lambda match: match["score"], reverse=True)
        return matched, unmatched

    @staticmethod
    async def _resolve_document(
        conn: asyncpg.Connection, external_id: str
    ) -> asyncpg.Record | None:
        """Map a RAG Core external_id back to a local knowledge document.

        Two links are accepted because ingestion can legitimately use either:
        the local UUID pushed as the external id, or a `source_id` the document
        already carried from its origin system.
        """
        return await conn.fetchrow(
            """
            SELECT id, title, document_type
              FROM knowledge_documents
             WHERE source_id = $1
                OR (id::text = $1)
             LIMIT 1
            """,
            external_id,
        )
