# C4 Level 3 — Components

Inside the two Python containers. Every box is a real module.

## Inside the API

```mermaid
graph TB
    client["Web UI · MCP server · agents"]

    subgraph api["API container"]
        routes["<b>routes</b><br/><i>app/api/routes.py</i><br/>REST surface, request shaping"]
        security["<b>security</b><br/><i>app/security.py</i><br/>API keys, scopes, rate limit"]
        schemas["<b>schemas</b><br/><i>app/schemas.py</i><br/>Pydantic contracts, validation"]

        answer["<b>answer</b><br/><i>app/rag/answer.py</i><br/>Guardrails: confidence gate,<br/>citation validation, judge, tracing"]
        prompts["<b>prompts</b><br/><i>app/rag/prompts.py</i>"]
        hybrid["<b>hybrid</b><br/><i>app/retrieval/hybrid.py</i><br/>Fusion SQL, rerank, Candidate"]

        pipeline["<b>pipeline</b><br/><i>app/ingestion/pipeline.py</i><br/>hash → chunk → embed → upsert"]
        chunking["<b>chunking</b><br/><i>app/ingestion/chunking.py</i><br/>Markdown tree · SQL statements"]

        providers["<b>providers</b><br/><i>app/providers/</i><br/>EmbeddingProvider · LLMProvider<br/>· RerankProvider adapters"]
        dbmod["<b>db</b><br/><i>app/db.py</i><br/>asyncpg pool, migrations, vectors"]
        queue["<b>queue</b><br/><i>app/queue.py</i><br/>arq enqueue, Redis"]
    end

    store[("Postgres")]
    rd[("Redis")]
    vendors["Model vendors"]

    client --> routes
    routes --> security
    routes --> schemas
    routes --> answer
    routes --> hybrid
    routes --> pipeline
    routes --> queue

    answer --> hybrid
    answer --> prompts
    answer --> providers
    hybrid --> providers
    pipeline --> chunking
    pipeline --> providers

    answer --> dbmod
    hybrid --> dbmod
    pipeline --> dbmod
    security --> dbmod
    security --> rd
    queue --> rd
    dbmod --> store
    providers --> vendors

    classDef comp fill:#85bbf0,stroke:#5d82a8,color:#000
    classDef store fill:#438dd5,stroke:#2e6295,color:#fff
    classDef ext fill:#999,stroke:#6b6b6b,color:#fff
    class routes,security,schemas,answer,prompts,hybrid,pipeline,chunking,providers,dbmod,queue comp
    class store,rd store
    class client,vendors ext
```

### The dependency rule that matters

`retrieval`, `rag` and `ingestion` depend on `providers` only through the abstract interfaces in `app/providers/base.py`. No module outside `app/providers/` imports a vendor SDK or knows a vendor name. That is what makes swapping Voyage for OpenAI a `.env` change rather than a refactor — and it is the invariant to protect when adding a provider.

`answer` depends on `hybrid`, never the reverse. Retrieval knows nothing about generation, so `/search` costs no LLM tokens.

## Inside the worker

```mermaid
graph TB
    rd[("Redis<br/>job queue")]

    subgraph worker["Worker container"]
        arq["<b>WorkerSettings</b><br/><i>app/worker.py</i><br/>arq runtime, retries, timeouts"]
        sched["<b>scheduler_tick</b><br/><i>cron, every minute</i><br/>Dispatches sources whose<br/>interval has elapsed"]
        prune["<b>prune_logs</b><br/><i>cron, nightly</i>"]

        tasks["<b>Tasks</b><br/>ingest_document · sync_source<br/>reembed_collection · async_answer"]

        subgraph conns["Connectors — app/ingestion/sources/"]
            reg["<b>registry</b><br/>@register + field specs,<br/>${NAME} secrets, probes,<br/>glob, HTML/ADF text"]
            impls["filesystem · git_repo · jira<br/>slack · confluence<br/>aws_logs · http_json"]
        end

        pipeline2["<b>pipeline</b><br/>shared with the API"]
    end

    store[("Postgres")]
    ext["Jira · Slack · Confluence<br/>CloudWatch · Git · HTTP"]

    rd --> arq
    arq --> sched
    arq --> prune
    arq --> tasks
    sched -->|"enqueue sync_source"| rd
    sched --> store
    tasks --> reg
    reg --> impls
    impls -->|"polls"| ext
    tasks --> pipeline2
    pipeline2 --> store
    tasks --> store

    classDef comp fill:#85bbf0,stroke:#5d82a8,color:#000
    classDef store fill:#438dd5,stroke:#2e6295,color:#fff
    classDef ext fill:#999,stroke:#6b6b6b,color:#fff
    class arq,sched,prune,tasks,reg,impls,pipeline2 comp
    class store,rd store
    class ext ext
```

### Connector contract

Every connector is one function with the same signature, registered by decorator:

```python
@register("jira")
async def run_jira_source(collection: str, config: dict, cursor: dict) -> SourceRun:
    ...
    return SourceRun(documents=[...], cursor={"updated_since": watermark})
```

The connector owns its cursor and decides what "changed since last time" means for its system — a watermark, a commit SHA, an mtime, a timestamp window. Everything downstream (hashing, chunking, embedding, upserting, job accounting) is shared, so a new vendor is one file plus one decorator.

`SOURCE_TYPES` is derived from the registry at import time, and `SourceIn` in `app/schemas.py` validates against it — registering a connector makes it accepted by the API with no schema edit.

## Component responsibilities

| Component | Owns | Explicitly does not |
|---|---|---|
| `routes` | HTTP shape, status codes, scope checks | Retrieval or generation logic |
| `security` | Key hashing, scopes, per-key rate limit | Vendor credentials |
| `hybrid` | The fusion SQL, reranking, `Candidate` | Deciding whether evidence is sufficient |
| `answer` | All four guardrails, tracing | Talking to Postgres for retrieval |
| `pipeline` | Idempotency, chunk replacement, status | Knowing where documents came from |
| `chunking` | Markdown tree, SQL statements, overlap | Embeddings |
| `providers` | Every vendor SDK and HTTP call | Business rules |
| connectors | Fetching and cursors | Chunking, embedding, storage |

---

Next: [C4 Level 4 — Code](04-code.md)
