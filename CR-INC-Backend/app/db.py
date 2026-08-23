"""asyncpg pool, shaped like RAG Core's so both services are operated the same way."""

from __future__ import annotations

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None

# Supabase (and any PgBouncer) in transaction pooling mode hands each transaction
# a different backend, so a statement this pool prepared on one is missing on the
# next — asyncpg then fails with "prepared statement _asyncpg_stmt_N_ does not
# exist" under exactly the concurrency the dashboard's polling produces. Disabling
# the cache is the supported way to run asyncpg through a transaction pooler; it
# costs a re-parse per query, which is noise next to the network round trip.
#
# Detected from the DSN rather than configured, because getting it wrong produces
# an intermittent failure that looks like anything but its cause.
_POOLED_HOSTS = ("pooler.supabase.com", "pgbouncer")


def _statement_cache_size() -> int:
    url = settings.database_url
    if any(marker in url for marker in _POOLED_HOSTS):
        return 0
    return 100  # asyncpg's default


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        # Sized for the dashboard's polling plus a few executions running at
        # once. An execution holds its connection for the whole run, so the
        # headroom above the API's own needs is deliberate.
        #
        # Configurable because the ceiling is not ours to choose on a managed
        # database: Supabase's transaction pooler allots a fixed number of client
        # connections per project, and a pool that asks for more than its share
        # fails at startup rather than degrading.
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=settings.database_pool_min_size,
            max_size=settings.database_pool_max_size,
            statement_cache_size=_statement_cache_size(),
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
