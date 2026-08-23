"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import providers
from app.api.routes import router
from app.config import settings
from app.db import close_pool, run_migrations
from app.providers.base import ProviderError
from app.queue import close_redis
from app.rag.prompt_store import seed_defaults
from app.security import ensure_bootstrap_key

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await run_migrations()
    await ensure_bootstrap_key()
    await seed_defaults()
    logger.info(
        "%s ready — embeddings=%s:%s llm=%s:%s rerank=%s",
        settings.app_name,
        settings.embedding_provider,
        settings.embedding_model,
        settings.llm_provider,
        settings.llm_model,
        settings.rerank_provider if settings.rerank_enabled else "disabled",
    )
    yield
    await providers.close_providers()
    await close_redis()
    await close_pool()


app = FastAPI(
    title="RAG Core",
    description=(
        "Provider-agnostic RAG service over PostgreSQL + pgvector.\n\n"
        "Hybrid retrieval (vector + full-text, fused with RRF), cross-encoder "
        "reranking, and grounded generation with mandatory citations, "
        "confidence-based abstention, and an LLM groundedness judge."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/v1")


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError) -> JSONResponse:
    # An upstream model outage is a 502, not a 500: the service is fine, the
    # dependency is not, and the caller should retry rather than page anyone.
    logger.error("provider error on %s: %s", request.url.path, exc)
    return JSONResponse(status_code=502, content={"detail": str(exc), "type": "provider_error"})


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# ------------------------------------------------------------------ web UI
# Mounted last, so /v1 and /docs keep priority over the catch-all.
_UI_DIST = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "dist"

if _UI_DIST.is_dir():

    class SPAStaticFiles(StaticFiles):
        """Serve the SPA, falling back to index.html for client-side routes.

        Without the fallback, reloading the browser on /search returns 404:
        the path exists in the React router, not on disk.

        StaticFiles *raises* HTTPException(404) rather than returning a 404
        response, so the fallback has to catch — checking the status code of
        the returned response silently never fires.
        """

        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                # An unknown API path must stay a 404. Falling back to the SPA
                # would answer a typo'd endpoint with HTML and status 200,
                # which is a miserable thing to debug from a client.
                if exc.status_code == 404 and not path.startswith("v1/"):
                    return await super().get_response("index.html", scope)
                raise

    app.mount("/", SPAStaticFiles(directory=_UI_DIST, html=True), name="ui")
    logger.info("serving the web UI from %s", _UI_DIST)
else:
    # No bundle built (`cd frontend && npm run build`) — the API still works.
    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {
            "service": settings.app_name,
            "docs": "/docs",
            "api": "/v1",
            "ui": "not built — run `npm run build` in frontend/",
        }
