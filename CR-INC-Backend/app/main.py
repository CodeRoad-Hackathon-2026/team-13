"""FastAPI entrypoint for the incident orchestrator.

Serves the dashboard's own API surface under /api, and nothing else. RAG Core is
reached from here server-side; its X-API-Key never crosses to a browser.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from app.agents.execution import settle_orphans
from app.api import router
from app.config import settings
from app.db import close_pool, get_pool
from app.rag_client import close_rag_client

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail at boot rather than on the first request: a dashboard that renders
    # then errors panel by panel is harder to diagnose than one that never starts.
    pool = await get_pool()

    # Anything still RUNNING got there before a restart, and nothing is going to
    # advance it — the background task that owned it died with the process.
    async with pool.acquire() as conn:
        orphaned = await settle_orphans(conn)
    if orphaned:
        logger.warning("settled %d execution(s) orphaned by a restart", orphaned)

    logger.info("incident orchestrator ready — rag=%s", settings.rag_api_url)
    yield
    await close_rag_client()
    await close_pool()


app = FastAPI(
    title="Incident Response Orchestrator",
    description=(
        "The dashboard's API. Owns the incident schema and calls RAG Core "
        "server-side so its credentials stay off the client."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# The dashboard is served from the Vite dev server in development and from the
# same origin in production. Listing origins rather than "*" because these
# endpoints mutate state — approve executes a real remediation.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # DELETE is here for one thing: removing an agent skill created by mistake.
    # Nothing else in the API deletes, and nothing else should acquire the habit.
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(router, prefix="/api")


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> PlainTextResponse:
    """Render HTTPException.detail as plain text.

    FastAPI's default is a `{"detail": ...}` JSON envelope, but the dashboard
    puts the raw response body straight into the operator-facing error message.
    A JSON blob on screen is worse than a sentence.
    """
    return PlainTextResponse(str(exc.detail), status_code=exc.status_code)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> PlainTextResponse:
    """Return plain text, not a JSON envelope.

    The frontend surfaces the response body to the operator verbatim
    (`ApiError` in src/api/client.ts uses it as the message), so a JSON blob
    would be shown to a human as a JSON blob.
    """
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return PlainTextResponse("Something went wrong on the server.", status_code=500)


@app.get("/health", tags=["ops"])
async def health() -> dict:
    return {"status": "ok"}
