"""Push local knowledge documents into RAG Core so retrieval can find them.

A `knowledge_documents` row is invisible to search on its own: RAG Core owns the
vector store, and nothing reaches it until the document is ingested there. On a
fresh stack the corpus is empty, so every agent that consults it abstains — which
is correct behaviour and also completely useless. This is what fixes that.

    python -m app.corpus            # ingest everything not yet ingested
    python -m app.corpus --all      # re-ingest, e.g. after changing the embedder

`external_id` is the local row's own UUID. That is the entire linkage:
RagRetrievalAgent resolves every hit back through it, so a document ingested
under any other id produces matches this database cannot name.
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from app.config import settings
from app.db import close_pool, get_pool
from app.rag_client import RagClient, RagError

logger = logging.getLogger(__name__)

DOCUMENTS = """
SELECT kd.id, kd.title, kd.summary, kd.content, kd.document_type,
       kd.source_url, s.name AS service_name,
       (SELECT i.environment FROM incidents i WHERE i.id = kd.incident_id) AS environment
FROM knowledge_documents kd
LEFT JOIN services s ON s.id = kd.service_id
ORDER BY kd.created_at
"""


def body(row) -> str:
    """Content if there is any, otherwise the summary.

    Never both concatenated and never empty: RAG Core rejects a blank body, and
    a document ingested as its own title alone matches nothing useful.
    """
    for candidate in (row["content"], row["summary"], row["title"]):
        if candidate and candidate.strip():
            return candidate.strip()
    return row["title"]


async def sync(reingest: bool = False, close: bool = False) -> dict[str, int]:
    pool = await get_pool()
    client = RagClient()
    ingested = failed = 0

    try:
        # Ingestion 400s against a collection that does not exist, and nothing
        # else creates it — a fresh stack has none.
        await client.ensure_collection(
            settings.rag_ingest_collection,
            "Incident knowledge written by the orchestrator",
        )

        async with pool.acquire() as conn:
            rows = await conn.fetch(DOCUMENTS)

        for row in rows:
            document_id = str(row["id"])
            try:
                await client.ingest_document(
                    external_id=document_id,
                    title=row["title"],
                    content=body(row),
                    source_url=row["source_url"],
                    # Metadata doubles as RAG Core's JSONB containment filter, so
                    # these are the dimensions a future search can narrow on.
                    metadata={
                        "document_type": row["document_type"],
                        "service": row["service_name"],
                        "environment": row["environment"],
                    },
                )
                ingested += 1
                logger.info("ingested %s — %s", document_id, row["title"])
            except RagError as exc:
                failed += 1
                logger.error("could not ingest %s (%s): %s", document_id, row["title"], exc)

        return {"total": len(rows), "ingested": ingested, "failed": failed}
    finally:
        await client.aclose()
        # Only when this is the whole program. Callers that keep working — the
        # demo walkthrough — must not have the pool closed under them.
        if close:
            await close_pool()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--all",
        action="store_true",
        help="re-ingest every document (RAG Core upserts by external_id)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=settings.log_level, format="%(levelname)s: %(message)s")
    result = asyncio.run(sync(reingest=args.all, close=True))

    print(f"{result['ingested']} of {result['total']} documents ingested", end="")
    print(f", {result['failed']} failed" if result["failed"] else "")
    # Non-zero on any failure: a half-populated corpus makes retrieval look like
    # it is working while quietly missing sources.
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
