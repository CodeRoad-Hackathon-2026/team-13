"""Redis connection and job enqueueing (arq)."""

from __future__ import annotations

import logging
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.config import settings

logger = logging.getLogger(__name__)

_redis: ArqRedis | None = None


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def get_redis() -> ArqRedis | None:
    """Shared arq/Redis pool. Returns None when Redis is unreachable.

    Redis is a degraded-mode dependency, not a hard one: without it the API
    still answers queries and ingests synchronously — it just cannot queue
    background work or rate-limit.
    """
    global _redis
    if _redis is None:
        try:
            _redis = await create_pool(redis_settings())
        except Exception:  # noqa: BLE001
            logger.warning("redis unavailable; async jobs and rate limiting are disabled")
            return None
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


async def enqueue(function: str, *args: Any, **kwargs: Any) -> str | None:
    redis = await get_redis()
    if redis is None:
        return None
    job = await redis.enqueue_job(function, *args, **kwargs)
    return job.job_id if job else None
