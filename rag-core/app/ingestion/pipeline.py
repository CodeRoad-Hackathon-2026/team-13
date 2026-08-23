"""Document ingestion: normalize → hash → chunk → embed → upsert.

Idempotent by (collection, external_id, content_hash): re-ingesting unchanged
content is a no-op, so a cron that replays the same feed every 5 minutes costs
nothing in embedding calls.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field, fields
from datetime import datetime

import asyncpg

from app import providers
from app.db import get_pool, to_pgvector
from app.ingestion.chunking import chunk_text

logger = logging.getLogger(__name__)


@dataclass
class DocumentInput:
    collection: str
    external_id: str
    content: str
    title: str | None = None
    uri: str | None = None
    source_type: str = "api"
    content_type: str = "text/markdown"
    metadata: dict = field(default_factory=dict)
    source_created_at: datetime | None = None
    source_updated_at: datetime | None = None


    @classmethod
    def from_payload(cls, payload: dict) -> "DocumentInput":
        """Build from a JSON-decoded payload.

        Documents reach the worker as JSON (queued through Redis, or stored in
        ingestion_jobs), so timestamps arrive as ISO strings. asyncpg rejects a
        str for a timestamptz parameter, so they are parsed back here — the one
        place every async ingestion path goes through.
        """
        allowed = {f.name for f in fields(cls)}
        data = {k: v for k, v in payload.items() if k in allowed}
        for key in ("source_created_at", "source_updated_at"):
            value = data.get(key)
            if isinstance(value, str):
                try:
                    data[key] = datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError:
                    data[key] = None
        return cls(**data)


@dataclass
class IngestResult:
    document_id: str
    status: str          # indexed | unchanged | failed
    chunk_count: int
    reason: str | None = None


def content_hash(text: str, metadata: dict | None = None) -> str:
    hasher = hashlib.sha256()
    hasher.update(text.encode())
    if metadata:
        for key in sorted(metadata):
            hasher.update(f"{key}={metadata[key]!r}".encode())
    return hasher.hexdigest()


async def resolve_collection(conn: asyncpg.Connection, name: str) -> asyncpg.Record:
    row = await conn.fetchrow("SELECT * FROM collections WHERE name = $1", name)
    if row is None:
        raise ValueError(f"collection '{name}' does not exist")
    return row


async def ensure_collection(
    name: str, description: str | None = None, metadata: dict | None = None
) -> asyncpg.Record:
    from app.config import settings

    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            """
            INSERT INTO collections (name, description, embedding_model, embedding_dim, metadata)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            ON CONFLICT (name) DO UPDATE
                SET description = COALESCE(EXCLUDED.description, collections.description),
                    updated_at  = now()
            RETURNING *
            """,
            name,
            description,
            settings.embedding_model,
            settings.embedding_dim,
            metadata or {},
        )


async def ingest_document(doc: DocumentInput, *, force: bool = False) -> IngestResult:
    pool = await get_pool()
    async with pool.acquire() as conn:
        collection = await resolve_collection(conn, doc.collection)
        digest = content_hash(doc.content, doc.metadata)

        existing = await conn.fetchrow(
            """
            SELECT id, content_hash, chunk_count
            FROM documents
            WHERE collection_id = $1 AND external_id = $2
            """,
            collection["id"],
            doc.external_id,
        )
        if (
            existing
            and existing["content_hash"] == digest
            and existing["chunk_count"] > 0
            and not force
        ):
            return IngestResult(
                document_id=str(existing["id"]),
                status="unchanged",
                chunk_count=existing["chunk_count"],
            )

        document_id = await conn.fetchval(
            """
            INSERT INTO documents (
                collection_id, external_id, source_type, uri, title, raw_content,
                content_hash, metadata, status, source_created_at, source_updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending', $9, $10)
            ON CONFLICT (collection_id, external_id) DO UPDATE SET
                source_type       = EXCLUDED.source_type,
                uri               = EXCLUDED.uri,
                title             = EXCLUDED.title,
                raw_content       = EXCLUDED.raw_content,
                content_hash      = EXCLUDED.content_hash,
                metadata          = EXCLUDED.metadata,
                status            = 'pending',
                error             = NULL,
                source_created_at = EXCLUDED.source_created_at,
                source_updated_at = EXCLUDED.source_updated_at,
                deleted_at        = NULL,
                updated_at        = now()
            RETURNING id
            """,
            collection["id"],
            doc.external_id,
            doc.source_type,
            doc.uri,
            doc.title,
            doc.content,
            digest,
            doc.metadata,
            doc.source_created_at,
            doc.source_updated_at,
        )

    # Document-level metadata is copied onto every chunk so retrieval filters
    # need to look at one column only.
    base_metadata = {
        **doc.metadata,
        "collection": doc.collection,
        "external_id": doc.external_id,
        "source_type": doc.source_type,
    }
    if doc.title:
        base_metadata["title"] = doc.title

    chunks = chunk_text(
        doc.content, content_type=doc.content_type, base_metadata=base_metadata
    )
    if not chunks:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE documents SET status='failed', error=$2, chunk_count=0 WHERE id=$1",
                document_id,
                "document produced no chunks",
            )
        return IngestResult(
            document_id=str(document_id),
            status="failed",
            chunk_count=0,
            reason="document produced no chunks",
        )

    try:
        vectors = await providers.embeddings().embed(
            [c.content for c in chunks], input_type="document"
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller and the job row
        logger.exception("embedding failed for document %s", doc.external_id)
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE documents SET status='failed', error=$2 WHERE id=$1",
                document_id,
                str(exc)[:2000],
            )
        return IngestResult(
            document_id=str(document_id), status="failed", chunk_count=0, reason=str(exc)
        )

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Replace wholesale: partial-diff chunking is not worth the
            # complexity when re-embedding a document costs one batched call.
            await conn.execute("DELETE FROM chunks WHERE document_id = $1", document_id)
            await conn.executemany(
                """
                INSERT INTO chunks (
                    document_id, collection_id, ordinal, content, context,
                    token_count, embedding, metadata
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8::jsonb)
                """,
                [
                    (
                        document_id,
                        collection["id"],
                        chunk.ordinal,
                        chunk.content,
                        chunk.context,
                        chunk.token_count,
                        to_pgvector(vector),
                        chunk.metadata,
                    )
                    for chunk, vector in zip(chunks, vectors)
                ],
            )
            await conn.execute(
                """
                UPDATE documents
                SET status='indexed', error=NULL, chunk_count=$2, updated_at=now()
                WHERE id=$1
                """,
                document_id,
                len(chunks),
            )

    return IngestResult(
        document_id=str(document_id), status="indexed", chunk_count=len(chunks)
    )


async def delete_document(collection: str, external_id: str) -> bool:
    """Soft-delete the document and hard-delete its chunks (frees the index)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE documents d
            SET deleted_at = now(), status = 'deleted', chunk_count = 0
            FROM collections c
            WHERE d.collection_id = c.id AND c.name = $1 AND d.external_id = $2
              AND d.deleted_at IS NULL
            RETURNING d.id
            """,
            collection,
            external_id,
        )
        if row is None:
            return False
        await conn.execute("DELETE FROM chunks WHERE document_id = $1", row["id"])
        return True
