# Flow — asking a question

The path from a question to a verified answer, and every point where the system can decide **not** to answer.

## Full sequence

```mermaid
sequenceDiagram
    autonumber
    actor C as Caller
    participant API as routes
    participant A as rag/answer
    participant H as retrieval/hybrid
    participant E as EmbeddingProvider
    participant PG as Postgres
    participant RR as RerankProvider
    participant L as LLMProvider
    participant J as judge

    C->>API: POST /v1/answer {query, collections, filters}
    API->>API: auth: key → scopes → rate limit
    API->>A: answer_question(...)

    A->>H: retrieve(query, collections, filters)
    H->>E: embed_one(query, input_type="query")
    E-->>H: vector[dim]

    Note over H,PG: one statement, two branches, fused by RRF
    H->>PG: vector ANN (HNSW) + full-text (tsvector) → RRF → feedback nudge
    PG-->>H: ~30 Candidates with every score component

    H->>RR: rerank(query, contents, top_n)
    RR-->>H: relevance scores
    H-->>A: top_k Candidates

    alt no results, or best confidence < MIN_CONTEXT_SCORE
        A->>PG: INSERT query_logs (abstained=true)
        A-->>C: {abstained: true, reason, sources}
        Note over A,C: the model is never called
    else evidence is sufficient
        A->>A: build_context() → numbered passages [1..n]
        A->>L: complete(ANSWER_SYSTEM, context + question)

        alt stop_reason == "refusal"
            A-->>C: {abstained: true, reason: "model_refusal"}
        else
            L-->>A: answer text
            A->>A: extract_citations() → resolve [n] to chunk_ids
            A->>A: strip markers outside 1..n → warnings
            A->>J: structured(GROUNDEDNESS_SCHEMA)
            J-->>A: {score, verdict, unsupported_claims}
            A->>PG: INSERT query_logs (full trace)
            A-->>C: answer + citations + confidence + groundedness + warnings
        end
    end
```

## The four decision points

```mermaid
flowchart TD
    Q([Question]) --> R[Hybrid retrieval + rerank]
    R --> G1{Any results?}
    G1 -->|no| AB1[/"abstain: no_results"/]
    G1 -->|yes| G2{"best confidence ≥<br/>MIN_CONTEXT_SCORE?"}
    G2 -->|no| AB2[/"abstain:<br/>below_confidence_threshold"/]
    G2 -->|yes| GEN[Generate with numbered passages]
    GEN --> G3{"stop_reason<br/>== refusal?"}
    G3 -->|yes| AB3[/"abstain: model_refusal"/]
    G3 -->|no| CIT[Resolve every citation marker]
    CIT --> G4{"markers outside<br/>the supplied range?"}
    G4 -->|yes| STRIP[Strip them, add a warning]
    G4 -->|no| JUDGE
    STRIP --> JUDGE[Groundedness judge]
    JUDGE --> G5{"score <<br/>MIN_GROUNDEDNESS_SCORE?"}
    G5 -->|yes| WARN[Return with a warning]
    G5 -->|no| OK([Answer + citations + verdict])
    WARN --> OK
    AB1 --> LOG[(query_logs)]
    AB2 --> LOG
    AB3 --> LOG
    OK --> LOG

    style AB1 fill:#f8d7da,stroke:#a94442
    style AB2 fill:#f8d7da,stroke:#a94442
    style AB3 fill:#f8d7da,stroke:#a94442
    style WARN fill:#fff3cd,stroke:#856404
    style OK fill:#d4edda,stroke:#2e6b34
```

**Abstention is cheap and early.** Gates 1 and 2 fire before any generation call, so a question the corpus cannot answer costs one embedding call and one query — not an LLM round trip. This is also the layer that catches most hallucinations, because most hallucinations are simply a model being asked something its context does not cover.

**A low groundedness score warns, it does not suppress.** The caller gets the answer plus the verdict and decides. Silently withholding an answer the model did produce would hide information from an operator mid-incident, which is its own failure mode.

## Streaming variant

`POST /v1/answer/stream` runs the same pipeline and emits Server-Sent Events:

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as stream_answer
    participant L as LLMProvider

    A-->>C: event: sources      (all passages, before any token)
    alt abstained
        A-->>C: event: abstained
        A-->>C: event: done
    else
        loop while generating
            L-->>A: text delta
            A-->>C: event: delta {text}
        end
        A-->>C: event: final     (citations, confidence, groundedness, warnings)
        A-->>C: event: done      {query_log_id}
    end
```

Two properties a client must respect:

1. **Sources arrive before the first token**, so a UI can render citations while the answer streams — and a caller can abort early if the retrieved passages are obviously wrong.
2. **Deltas are unverified by construction.** Citation validation and the judge run on the assembled answer, so `final` is the event to trust. A client that renders deltas and ignores `final` has opted out of the guardrails.

`EventSource` cannot be used: it only issues GET, and this endpoint is a POST. Clients read the body stream and parse frames themselves — see [frontend.md](../frontend.md#consuming-the-sse-stream).

## Async variant

With `callback_url` set, `/v1/answer` returns `202` immediately, the worker runs the same `answer_question()`, and the result is POSTed to the caller. The answer is persisted either way, so a failed delivery is recoverable through `GET /v1/answer/{request_id}` — the callback is an optimization, not the source of truth.

## Where the time goes

| Stage | Typical | Notes |
|---|---|---|
| Query embedding | 50–200 ms | One vendor call; the floor for any search |
| Fusion SQL | 2–10 ms | Measured on the seeded corpus; HNSW keeps this flat as the corpus grows |
| Rerank | 100–400 ms | Skipped when `RERANK_ENABLED=false` |
| Generation | seconds | Dominates; stream it |
| Groundedness judge | 1–3 s | Runs at `JUDGE_EFFORT=low`; disable with `GROUNDEDNESS_CHECK=false` |

The retrieval half is milliseconds. Everything expensive is a vendor round trip, which is why `/search` exists as a separate endpoint: an agent that only needs evidence should not pay for generation.

---

Related: [retrieval.md](../retrieval.md) · [anti-hallucination.md](../anti-hallucination.md)
