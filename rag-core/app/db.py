"""asyncpg pool, migrations, and vector serialization helpers."""

from __future__ import annotations

import json
import logging
import pathlib
from typing import Any, Sequence

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parent.parent / "db" / "migrations"

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Decode jsonb/json as Python objects instead of raw strings."""
    for typename in ("json", "jsonb"):
        await conn.set_type_codec(
            typename,
            encoder=json.dumps,
            decoder=json.loads,
            schema="pg_catalog",
        )


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.asyncpg_dsn,
            min_size=settings.db_pool_min,
            max_size=settings.db_pool_max,
            init=_init_connection,
            command_timeout=settings.request_timeout_seconds,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def run_migrations() -> None:
    """Apply every .sql file in db/migrations exactly once, in name order."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename   TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        applied = {
            r["filename"]
            for r in await conn.fetch("SELECT filename FROM schema_migrations")
        }
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in applied:
                continue
            sql = (
                path.read_text()
                .replace("__EMBEDDING_DIM__", str(settings.embedding_dim))
                .replace("__FTS_CONFIG__", settings.fts_config)
            )
            logger.info("applying migration %s", path.name)
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)", path.name
                )


def to_pgvector(embedding: Sequence[float]) -> str:
    """asyncpg has no native vector codec; pgvector accepts the literal form."""
    return "[" + ",".join(f"{float(x):.8f}" for x in embedding) + "]"


def jsonb(value: Any) -> Any:
    """Normalize a jsonb parameter.

    The connection registers a jsonb codec, so dicts/lists are encoded by
    asyncpg. Every jsonb parameter must carry an explicit ``::jsonb`` cast in
    the SQL so Postgres reports the parameter type as jsonb.
    """
    return value if value is not None else {}
