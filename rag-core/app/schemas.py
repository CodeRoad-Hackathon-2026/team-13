"""Request/response models. These define the contract agents code against."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


# ------------------------------------------------------------- collections
class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9._-]+$")
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CollectionOut(BaseModel):
    id: str
    name: str
    description: str | None
    embedding_model: str
    embedding_dim: int
    document_count: int = 0
    chunk_count: int = 0
    created_at: datetime


# --------------------------------------------------------------- documents
class DocumentIn(BaseModel):
    collection: str
    external_id: str = Field(min_length=1, max_length=512)
    content: str = Field(min_length=1)
    title: str | None = None
    uri: str | None = None
    source_type: str = "api"
    content_type: str = "text/markdown"
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_created_at: datetime | None = None
    source_updated_at: datetime | None = None


class DocumentBatchIn(BaseModel):
    documents: list[DocumentIn] = Field(min_length=1, max_length=500)
    # Async is the default: embedding a batch can take minutes, and an agent
    # posting incident context should not block on it.
    mode: Literal["async", "sync"] = "async"


class IngestAccepted(BaseModel):
    accepted: int
    mode: str
    job_ids: list[str] = Field(default_factory=list)
    results: list[dict] = Field(default_factory=list)


# ------------------------------------------------------------------ search
class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    collections: list[str] | None = None
    # JSONB containment filter, e.g. {"service": "payments", "severity": "P1"}
    filters: dict[str, Any] = Field(default_factory=dict)
    top_k: int = Field(default=8, ge=1, le=50)
    rerank: bool = True


class SearchResponse(BaseModel):
    query: str
    results: list[dict]
    took_ms: int


# ------------------------------------------------------------------ answer
class AnswerRequest(BaseModel):
    query: str = Field(min_length=1)
    collections: list[str] | None = None
    filters: dict[str, Any] = Field(default_factory=dict)
    top_k: int = Field(default=8, ge=1, le=20)
    # Correlation ids so a whole incident's traffic can be pulled from the logs.
    agent_id: str | None = None
    incident_id: str | None = None
    # When set, the answer is computed in the background and POSTed here.
    callback_url: HttpUrl | None = None

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("query cannot be blank")
        return stripped


class AnswerAccepted(BaseModel):
    request_id: str
    status: str
    callback_url: str


# ---------------------------------------------------------------- feedback
class FeedbackIn(BaseModel):
    query_log_id: str | None = None
    chunk_id: str | None = None
    document_id: str | None = None
    rating: int = Field(ge=-1, le=1)
    reason: str | None = None
    agent_id: str | None = None


# ----------------------------------------------------------------- sources
class SourceIn(BaseModel):
    collection: str
    name: str
    # Validated against the connector registry rather than a hardcoded Literal,
    # so registering a new connector does not require touching this schema.
    type: str
    config: dict[str, Any]
    interval_seconds: int = Field(default=3600, ge=60)
    enabled: bool = True

    @field_validator("type")
    @classmethod
    def known_source_type(cls, value: str) -> str:
        from app.ingestion.sources import SOURCE_TYPES

        if value not in SOURCE_TYPES:
            raise ValueError(
                f"unknown source type '{value}'; available: {', '.join(SOURCE_TYPES)}"
            )
        return value


class SourceOut(BaseModel):
    id: str
    collection: str
    name: str
    type: str
    interval_seconds: int
    enabled: bool
    last_run_at: datetime | None
    last_status: str | None
    last_error: str | None
    # Redacted: ${NAME} references are shown, literal credentials are masked.
    config: dict[str, Any] = Field(default_factory=dict)
    next_run_at: datetime | None = None


class SourceUpdate(BaseModel):
    """Partial update. Every field is optional; omitted ones are left alone.

    `None` has to mean "not supplied" rather than "clear it", so there is no way
    to null a column through this — which is correct, since none of these are
    nullable. `config` is replaced wholesale, not merged: a merge would make
    removing a key impossible.
    """

    collection: str | None = None
    name: str | None = None
    type: str | None = None
    config: dict[str, Any] | None = None
    interval_seconds: int | None = Field(default=None, ge=60)
    enabled: bool | None = None

    @field_validator("type")
    @classmethod
    def known_source_type(cls, value: str | None) -> str | None:
        from app.ingestion.sources import SOURCE_TYPES

        if value is not None and value not in SOURCE_TYPES:
            raise ValueError(
                f"unknown source type '{value}'; available: {', '.join(SOURCE_TYPES)}"
            )
        return value


class SourceTestIn(BaseModel):
    type: str
    config: dict[str, Any] = Field(default_factory=dict)


class SourceTestOut(BaseModel):
    ok: bool
    message: str
    detail: dict[str, Any] = Field(default_factory=dict)


class SourceRunOut(BaseModel):
    id: str
    trigger: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    documents: int
    indexed: int
    unchanged: int
    failed: int
    error: str | None


# ----------------------------------------------------------------- secrets
class SecretIn(BaseModel):
    name: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Z][A-Z0-9_]*$",
        description="Referenced from a source config as ${NAME}.",
    )
    value: str = Field(min_length=1)
    description: str | None = None


class SecretOut(BaseModel):
    """Never carries the secret. `hint` is the last four characters."""

    name: str
    description: str | None = None
    hint: str
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None = None
    used_by: list[str] = Field(default_factory=list)


# ----------------------------------------------------------------- prompts
class PromptSaveIn(BaseModel):
    body: str = Field(min_length=1)
    collection: str | None = None
    note: str | None = None
    created_by: str | None = None


class TracePinIn(BaseModel):
    reason: str | None = Field(
        default=None,
        description="Why this trace must outlive the retention window, e.g. a PR URL.",
    )


# -------------------------------------------------------------- api keys
class ApiKeyIn(BaseModel):
    name: str
    scopes: list[Literal["read", "write", "admin"]] = Field(default_factory=lambda: ["read"])
    rate_limit_per_minute: int = Field(default=120, ge=1)


class ApiKeyOut(BaseModel):
    id: str
    name: str
    # Returned exactly once, at creation.
    api_key: str
    scopes: list[str]
