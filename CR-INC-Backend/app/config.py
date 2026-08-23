"""Settings for the incident orchestrator.

Everything the agents need to reach Postgres and RAG Core, and nothing else.
The RAG API key lives here — on the server — precisely so it never reaches a
browser: RAG Core authenticates with a static key whose scope also covers
/v1/secrets, so it is not a credential a frontend can be trusted with.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://incident:incident@localhost:5432/incident_response"
    # The pool's ceiling is not ours to choose on a managed database. Supabase
    # allots a fixed number of pooler client connections per project, and asking
    # for more than the share fails at startup — so this is env-tunable rather
    # than a constant in app/db.py.
    database_pool_min_size: int = 2
    database_pool_max_size: int = 20

    # RAG Core. The URL already includes the /v1 prefix the service mounts under.
    rag_api_url: str = "http://localhost:8902/v1"
    rag_api_key: str = ""
    rag_timeout_seconds: float = 60.0
    # None means "every collection". Narrow it once the corpus holds more than
    # incident knowledge.
    rag_collections: list[str] | None = None

    # Collection that Knowledge Generation writes into. Retrieval reads every
    # collection unless rag_collections narrows it, so a document ingested here
    # is findable without further configuration.
    rag_ingest_collection: str = "incidents"

    retrieval_top_k: int = 8
    # Above this similarity the incident is treated as previously seen. Also the
    # value written to incidents.confidence_score, so it must stay within 0..1.
    #
    # Compared against the cross-encoder or cosine similarity, never against the
    # RRF rank score RAG Core sorts by — that one sits near 0.03 whatever the
    # match, which would leave this permanently unreachable.
    #
    # Calibrate per embedding model — this default is a starting point, not a
    # measured one. On text-embedding-3-large, an incident matched against the
    # runbook that actually covers it scored 0.49–0.56, so anything above ~0.6
    # leaves the flag permanently false and the funnel's "RAG match found" stage
    # dropping everything. That is four observations on a seeded corpus; revisit
    # it once there is real traffic.
    known_incident_threshold: float = 0.50

    # Origins allowed to call this API. The Vite dev server by default; in
    # production the dashboard is same-origin and needs none of these.
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]

    # Hosts an approved action may call. The endpoint in an action's parameters
    # is written by a language model, so this is what stands between "a human
    # approved a remediation" and "a human approved a request to anywhere".
    # Defaults to loopback: real targets are an explicit operator decision.
    execution_allowed_hosts: list[str] = ["localhost", "127.0.0.1"]
    execution_timeout_seconds: float = 30.0
    # Ceiling on one whole execution, connection included. A clone plus a model
    # round-trip is minutes, and an execution holds a pool connection for its
    # duration — so this is what stops one slow remediation from starving the
    # dashboard's own queries. Safe to enforce because a timed-out execution is
    # settled rather than left RUNNING.
    execution_total_timeout_seconds: float = 300.0

    # ---- change delivery -------------------------------------------------
    # Deny by default, like execution_allowed_hosts: nothing can be pushed until
    # a repository is listed deliberately.
    change_delivery_allowed_repos: list[str] = []
    change_delivery_allowed_hosts: list[str] = ["github.com"]
    change_delivery_branch_prefix: str = "remediate/"
    # Dry run by default — clone, apply and commit, but stop before pushing. The
    # right default for a deployment with no deploy key, and it lets the feature
    # ship before one exists.
    change_delivery_push_enabled: bool = False
    change_delivery_ssh_key_path: str = "/run/secrets/deploy_key"
    change_delivery_known_hosts: str = "/etc/ssh/ssh_known_hosts"
    # Not /tmp: images often mount that as a small tmpfs, and a clone is not small.
    change_delivery_workdir: str = "/var/tmp/change-delivery"
    change_delivery_max_regenerations: int = 2
    # How much of the real file to show the model around each hunk when asking it
    # to rewrite a patch that did not apply.
    change_delivery_context_lines: int = 60
    git_timeout_seconds: float = 120.0

    # ---- agent policy ----------------------------------------------------
    # Whether an agent may be set to act autonomously at all. Off by default,
    # the same shape as change_delivery_push_enabled: /api/* has no
    # authentication, and "remove the human from the loop" is not a state that
    # anyone who can reach the dashboard should be able to select. With this off
    # the level is still visible and still refused, which is more honest than
    # hiding it.
    agent_autonomy_enabled: bool = False

    log_level: str = "INFO"


settings = Settings()
