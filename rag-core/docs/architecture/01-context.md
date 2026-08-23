# C4 Level 1 — System Context

Who uses the service, and what it depends on.

```mermaid
graph TB
    operator["<b>On-call operator</b><br/><i>[Person]</i><br/>Asks questions during an<br/>incident, rates what helped"]
    agent["<b>Incident agent</b><br/><i>[Software System]</i><br/>CrewAI crew / Claude Code /<br/>any MCP or HTTP client"]

    rag["<b>RAG Core</b><br/><i>[Software System]</i><br/>Hybrid retrieval over an operational<br/>corpus, with grounded generation:<br/>mandatory citations, confidence-based<br/>abstention, groundedness verdict"]

    subgraph vendors["Model vendors — swappable by config"]
        llm["<b>Generation + judge</b><br/>Anthropic / OpenAI / Ollama"]
        emb["<b>Embeddings</b><br/>Voyage / OpenAI / Ollama"]
        rrk["<b>Reranker</b><br/>Voyage / Cohere / LLM"]
    end

    subgraph knowledge["Knowledge sources — polled on a schedule"]
        jira["Jira<br/><i>resolved tickets + comments</i>"]
        slack["Slack<br/><i>incident channels</i>"]
        conf["Confluence<br/><i>runbooks</i>"]
        aws["AWS CloudWatch<br/><i>log patterns</i>"]
        git["Git repos<br/><i>SQL, migrations, IaC</i>"]
        fs["Filesystem / any JSON API"]
    end

    operator -->|"asks, rates"| rag
    agent -->|"rag_search, rag_answer,<br/>rag_ingest, rag_feedback"| rag

    rag -->|"embed, generate,<br/>rerank, judge"| vendors
    rag -->|"polls incrementally"| knowledge
    agent -.->|"writes back<br/>what it learned"| rag

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef system fill:#1168bd,stroke:#0b4884,color:#fff
    classDef external fill:#999,stroke:#6b6b6b,color:#fff
    class operator person
    class agent,rag system
    class llm,emb,rrk,jira,slack,conf,aws,git,fs external
```

## What the system is responsible for

| Responsibility | Why it lives here and not in the agent |
|---|---|
| Retrieval quality | Hybrid search, fusion and reranking are stateful and tunable; every consumer benefits from one tuned implementation. |
| Refusing to answer | The abstention gate must be enforced centrally. An agent that decides for itself whether the evidence is sufficient will eventually decide wrong. |
| Citation integrity | Fabricated citations are stripped server-side, so no consumer can surface a source that does not exist. |
| Audit trail | Every query, passage, answer and verdict is persisted in one place, independent of which agent asked. |

## Two consumer shapes

**Retrieval-only** (`/search`, `rag_search`) — the caller gets passages with scores and reasons over them itself. No LLM tokens are spent by the service. This is the right call when the agent is already holding context the service does not have.

**Grounded answer** (`/answer`, `rag_answer`) — the service retrieves, gates on confidence, generates, validates the citations, and judges the result. The caller gets prose plus a verdict it can act on.

The distinction matters because `abstained: true` is a *result*, not a failure: it means the corpus cannot support an answer. A consumer that treats it as an error and falls back to its own knowledge silently defeats the whole design.

## Trust boundaries

- Consumers authenticate with an API key carrying `read` / `write` / `admin` scopes and a per-key rate limit.
- Connector credentials are referenced as `${NAME}` and resolved at poll time from the encrypted vault first, then the **worker's** environment. Vault rows are AES-256-GCM ciphertext under `SECRETS_KEY`, which lives in the server environment; no endpoint returns a plaintext secret, and `GET /v1/sources` redacts any literal credential a caller managed to POST.
- Model vendors receive query text and retrieved passages. Anything indexed is anything sent — the corpus boundary is the privacy boundary.

---

Next: [C4 Level 2 — Containers](02-containers.md)
