"""Shared request-scoped helpers."""

from __future__ import annotations

from typing import AsyncIterator
from uuid import UUID

import asyncpg
from fastapi import HTTPException, Query

from app.db import get_pool


async def connection() -> AsyncIterator[asyncpg.Connection]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


def parse_env(env: str | None = Query(default=None)) -> list[str] | None:
    """Environment filter.

    The frontend's `buildQuery` joins arrays with commas rather than repeating
    the key, so `env=Production,Staging` is what actually arrives — regardless
    of what the contract doc says about repetition.
    """
    if not env:
        return None
    values = [part.strip() for part in env.split(",") if part.strip()]
    return values or None


def parse_service(service: str | None = Query(default=None)) -> str | None:
    """The service filter: a `services.id`, so a UUID.

    Validated here rather than left to the bind. asyncpg raises DataError on a
    malformed UUID, and that surfaces as a 500 with a stack trace for what is
    really a bad request — a filter carrying the wrong kind of id then looks
    like a broken service, and gets debugged as one. Callers get ids from
    GET /api/services.
    """
    if not service:
        return None
    try:
        UUID(service)
    except ValueError:
        raise bad_request(
            f"service must be a services.id UUID, got {service!r} — see GET /api/services"
        ) from None
    return service


def not_found(message: str) -> HTTPException:
    """404 whose body is the message itself.

    Every error body here is plain text because the dashboard shows it to the
    operator unchanged.
    """
    return HTTPException(status_code=404, detail=message)


def bad_request(message: str) -> HTTPException:
    """400, same plain-text body as not_found — for a query parameter the client
    got wrong."""
    return HTTPException(status_code=400, detail=message)
