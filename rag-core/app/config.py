from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ------------------------------------------------------------------ app
    app_name: str = "rag-core"
    environment: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"
    auth_enabled: bool = True
    # Bootstrapped on first startup so the demo works without a manual step.
    bootstrap_api_key: str | None = None

    # ----------------------------------------------------------- postgres
    database_url: str = "postgresql://rag:rag@localhost:5432/rag"
    db_pool_min: int = 2
    db_pool_max: int = 10
    # Text search configuration used by the generated tsvector column. Baked
    # into the schema at migration time, so changing it requires a reindex.
    fts_config: str = "simple"

    redis_url: str = "redis://localhost:6379/0"

    # ---------------------------------------------------------- providers
    # Every provider is selected by name and configured by token only.
    embedding_provider: str = "voyage"
    embedding_model: str = "voyage-3"
    embedding_dim: int = 1024
    embedding_batch_size: int = 96

    llm_provider: str = "anthropic"
    llm_model: str = "claude-opus-5"
    llm_max_tokens: int = 4096
    # Judge runs on every answer, so it is tuned for latency, not depth.
    #
    # Defaults to llm_model rather than a hardcoded model name: the judge is
    # built with the *same provider* as generation, so a concrete default here
    # would send e.g. "claude-opus-5" to OpenAI the moment LLM_PROVIDER changes.
    judge_model: str | None = None
    judge_effort: Literal["low", "medium", "high", "xhigh", "max"] = "low"

    rerank_provider: str = "voyage"          # voyage | cohere | llm | none
    rerank_model: str = "rerank-2.5"

    anthropic_api_key: str | None = None
    voyage_api_key: str | None = None
    openai_api_key: str | None = None
    cohere_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"

    # ---------------------------------------------------------- chunking
    chunk_max_tokens: int = 512
    chunk_overlap_tokens: int = 64
    chunk_min_tokens: int = 32

    # --------------------------------------------------------- retrieval
    retrieval_candidates: int = 60      # per branch (vector, lexical)
    retrieval_top_k: int = 8            # after fusion + rerank
    rrf_k: int = 60                     # RRF smoothing constant
    vector_weight: float = 1.0
    lexical_weight: float = 1.0
    feedback_weight: float = 0.15       # nudge from the agent feedback loop
    rerank_enabled: bool = True
    rerank_candidates: int = 30

    # -------------------------------------------------- anti-hallucination
    # Below this confidence the API refuses to answer instead of extrapolating.
    # The single most effective guardrail, and the one that has to be measured:
    # `make eval` reports where answerable and unanswerable questions separate.
    min_context_score: float = 0.48
    require_citations: bool = True
    groundedness_check: bool = True
    # Reject /answer calls with no incident_id.
    #
    # On by default because the correlation id is what makes a whole incident
    # reconstructable afterwards, and an agent that forgets it produces a trace
    # nobody can find later — a loss that is invisible until the audit. Set it
    # false for exploratory use where no incident exists.
    require_incident_id: bool = True
    # An answer scoring below this is returned with a warning, not suppressed —
    # the caller decides what to do with a weakly grounded answer.
    min_groundedness_score: float = 0.6

    # ------------------------------------------------------------- secrets
    # 32-byte urlsafe-base64 key for the connector secret vault. Unset means
    # the vault is disabled and connectors fall back to ${VAR} from the
    # worker environment. Generate one with `make secrets-key`.
    secrets_key: str | None = None

    # ------------------------------------------------------------ worker
    worker_concurrency: int = 4
    source_scheduler_interval_seconds: int = 60
    job_max_attempts: int = 3
    # How long an unpinned trace survives. Pinned traces — the ones a PR links
    # to for its justification — are never deleted.
    trace_retention_days: int = 30

    request_timeout_seconds: float = 120.0

    @property
    def effective_judge_model(self) -> str:
        """The model the groundedness judge runs on."""
        return self.judge_model or self.llm_model

    @property
    def asyncpg_dsn(self) -> str:
        # asyncpg does not understand the `postgresql+driver://` form.
        return self.database_url.replace("postgresql+asyncpg://", "postgresql://")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
