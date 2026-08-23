# Deployment — local (docker compose)

The topology that runs today and that a reviewer can reproduce with `make up`.

```mermaid
graph TB
    subgraph host["Developer machine — macOS / Linux"]
        browser["Browser<br/><i>localhost:8000</i>"]
        agentproc["Agent process<br/><i>Claude Code / CrewAI crew</i>"]

        subgraph docker["Docker Engine — network: hackaton_default"]
            subgraph capi["<b>api</b>"]
                uvicorn["uvicorn app.main:app --reload<br/><i>:8000</i><br/>serves /v1 + built SPA"]
            end
            subgraph cworker["<b>worker</b>"]
                arq["watchfiles → arq WorkerSettings<br/><i>no exposed port</i>"]
            end
            subgraph cpg["<b>postgres</b>"]
                pg["pgvector/pgvector:pg17<br/><i>:5432</i>"]
                vol[("volume<br/>pgdata")]
            end
            subgraph credis["<b>redis</b>"]
                rd["redis:7-alpine<br/><i>:6379</i>"]
            end
            subgraph cfront["<b>frontend</b> — dev profile only"]
                vite["node:22-alpine · vite dev<br/><i>:5173, proxies /v1 → api</i>"]
            end
        end

        bind1[/"bind mount<br/>. → /srv (rw)"/]
        bind2[/"bind mount<br/>./data → /data (ro)"/]
    end

    vendors["Model vendors<br/>api.anthropic.com · api.voyageai.com"]
    ext["Jira · Slack · Confluence<br/>CloudWatch · GitHub"]

    browser -->|"8000"| uvicorn
    browser -.->|"5173, dev"| vite
    vite -->|"proxy /v1"| uvicorn
    agentproc -->|"stdio → MCP → HTTP"| uvicorn

    uvicorn --> pg
    uvicorn --> rd
    arq --> pg
    arq --> rd
    pg --- vol

    bind1 -.-> uvicorn
    bind1 -.-> arq
    bind2 -.-> arq

    uvicorn --> vendors
    arq --> vendors
    arq --> ext

    classDef container fill:#438dd5,stroke:#2e6295,color:#fff
    classDef store fill:#2e6295,stroke:#1a3a5c,color:#fff
    classDef ext fill:#999,stroke:#6b6b6b,color:#fff
    classDef mount fill:#f5f5f5,stroke:#999,color:#333
    class uvicorn,arq,pg,rd,vite container
    class vol store
    class vendors,ext,browser,agentproc ext
    class bind1,bind2 mount
```

## Startup order and health gating

`api` and `worker` both declare `depends_on: { postgres: service_healthy, redis: service_healthy }`, so neither starts until Postgres answers `pg_isready` and Redis answers `PING`. Without that gate the first migration races the database's own initialization.

```mermaid
sequenceDiagram
    autonumber
    participant C as docker compose
    participant P as postgres
    participant R as redis
    participant A as api
    participant W as worker

    C->>P: start
    C->>R: start
    loop until healthy
        P-->>C: pg_isready
        R-->>C: PING
    end
    C->>A: start
    C->>W: start
    A->>P: run_migrations()
    A->>P: ensure_bootstrap_key()
    W->>P: run_migrations() (idempotent)
    W->>R: register cron jobs
    W->>W: scheduler_tick (run_at_startup)
```

Migrations run from **both** containers. `schema_migrations` makes that safe: each file is applied once, inside a transaction, whichever process gets there first.

## Volumes and mounts

| Mount | Purpose | Note |
|---|---|---|
| `pgdata` volume | Database durability | `make reset` drops this — it is the only destructive target |
| `.` → `/srv` (rw) | Hot reload for API and worker | Development convenience; a production image copies the code instead |
| `./data` → `/data` (ro) | Corpus for `filesystem` sources | Read-only on purpose: ingestion must never mutate its input |
| `/tmp/rag-repos` (in-container) | `git_repo` clone cache | Ephemeral; a cold start just re-clones shallow |

## Configuration

`.env` is loaded by compose via `env_file` and by the app via pydantic-settings. Compose overrides `DATABASE_URL` and `REDIS_URL` to service names, so the same `.env` works on the host (`localhost:55432`) and inside containers (`postgres:5432`).

Connector secrets are referenced from source configs as `${VAR}` and resolved from the **worker's** environment, which is why they belong in `.env` rather than in the JSON config body.

## What this topology is not

This is a development and demo topology. Before it faces real traffic:

- **`--reload` and `watchfiles` must go.** Both watch the filesystem and reload on change; in production the code is baked into the image.
- **CORS is `allow_origins=["*"]`.** Fine when the SPA is same-origin behind the API; restrict it the moment anything else calls the API from a browser.
- **The API key lives in the browser's `localStorage`.** Acceptable for a demo or an internal tool; a public deployment needs a session-cookie BFF so the key never reaches the client.
- **No TLS, no replicas, no backups.** Postgres is a single container with one volume.
- **Bind-mounting the source into containers** means the running code is whatever is on disk, not what was built.

A production topology (managed Postgres with pgvector, a Redis service, separate API and worker scaling, secrets in a vault, IAM role for the CloudWatch connector) is deliberately not drawn here — the target platform has not been chosen, and a diagram of infrastructure nobody has agreed to is documentation that ages badly.

## Operating

```bash
make up       # build and start everything; creates .env from .env.example if missing
make seed     # load the demo runbooks and incidents
make logs     # tail api + worker
make health   # GET /v1/health — reports postgres, redis and resolved providers
make psql     # database shell
make reset    # stop and DROP the data volume
```

`GET /v1/health` returns `status: "degraded"` rather than failing when Redis is unreachable, because the API still serves queries without it — see the degraded-mode table in [containers](02-containers.md#degraded-modes).
