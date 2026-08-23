"""API-key authentication, scopes, and per-key rate limiting."""

from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from app.config import settings
from app.db import get_pool

KEY_PREFIX = "rag_sk_"


@dataclass
class ApiKeyContext:
    id: str | None
    name: str
    scopes: list[str]
    rate_limit_per_minute: int

    def has(self, scope: str) -> bool:
        return "admin" in self.scopes or scope in self.scopes


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


async def create_api_key(
    name: str, scopes: list[str], rate_limit_per_minute: int = 120
) -> tuple[str, str]:
    """Return (raw_key, id). The raw key is never stored and never recoverable."""
    raw = generate_key()
    pool = await get_pool()
    async with pool.acquire() as conn:
        key_id = await conn.fetchval(
            """
            INSERT INTO api_keys (name, key_hash, key_prefix, scopes, rate_limit_per_minute)
            VALUES ($1, $2, $3, $4::text[], $5)
            ON CONFLICT (key_hash) DO NOTHING
            RETURNING id
            """,
            name,
            hash_key(raw),
            raw[: len(KEY_PREFIX) + 8],
            scopes,
            rate_limit_per_minute,
        )
    return raw, str(key_id)


async def ensure_bootstrap_key() -> None:
    """Register the key from BOOTSTRAP_API_KEY so a fresh stack is usable."""
    if not settings.bootstrap_api_key:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO api_keys (name, key_hash, key_prefix, scopes, rate_limit_per_minute)
            VALUES ('bootstrap', $1, $2, ARRAY['admin'], 6000)
            ON CONFLICT (key_hash) DO NOTHING
            """,
            hash_key(settings.bootstrap_api_key),
            settings.bootstrap_api_key[:16],
        )


# ------------------------------------------------------------- rate limiting
# Fixed window in Redis, keyed per API key. Coarse on purpose: the goal is to
# stop one runaway agent from exhausting the embedding quota, not to be a
# precise traffic shaper.
async def _check_rate_limit(key_id: str, limit: int) -> None:
    from app.queue import get_redis

    redis = await get_redis()
    if redis is None:
        return
    window = int(time.time() // 60)
    bucket = f"ratelimit:{key_id}:{window}"
    count = await redis.incr(bucket)
    if count == 1:
        await redis.expire(bucket, 90)
    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"rate limit exceeded ({limit}/min)",
            headers={"Retry-After": "60"},
        )


async def get_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> ApiKeyContext:
    if not settings.auth_enabled:
        return ApiKeyContext(id=None, name="anonymous", scopes=["admin"], rate_limit_per_minute=10_000)

    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="missing X-API-Key header"
        )

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, name, scopes, rate_limit_per_minute
            FROM api_keys
            WHERE key_hash = $1 AND revoked_at IS NULL
            """,
            hash_key(x_api_key),
        )
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid API key"
            )
        await conn.execute(
            "UPDATE api_keys SET last_used_at = now() WHERE id = $1", row["id"]
        )

    context = ApiKeyContext(
        id=str(row["id"]),
        name=row["name"],
        scopes=list(row["scopes"]),
        rate_limit_per_minute=row["rate_limit_per_minute"],
    )
    await _check_rate_limit(context.id, context.rate_limit_per_minute)
    return context


def require_scope(scope: str):
    """Dependency factory: ``Depends(require_scope("write"))``."""

    async def dependency(key: ApiKeyContext = Depends(get_api_key)) -> ApiKeyContext:
        if not key.has(scope):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"this API key lacks the '{scope}' scope",
            )
        return key

    return dependency
