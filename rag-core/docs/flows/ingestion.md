# Flow — ingesting a document

Everything that enters the index goes through one pipeline, whether it was pushed by an agent or pulled by a connector.

## Push path

```mermaid
sequenceDiagram
    autonumber
    actor C as Caller
    participant API as routes
    participant PG as Postgres
    participant R as Redis
    participant W as worker
    participant P as pipeline
    participant CH as chunking
    participant E as EmbeddingProvider

    C->>API: POST /v1/documents {documents[], mode}
    API->>PG: INSERT ingestion_jobs (queued)
    API->>R: enqueue ingest_document_task
    API-->>C: 202 {job_ids}

    Note over API,R: if Redis is unreachable, the API ingests<br/>synchronously rather than dropping the document

    W->>R: dequeue
    W->>P: ingest_document(DocumentInput.from_payload(...))
    P->>P: content_hash(content + metadata)
    P->>PG: SELECT existing by (collection, external_id)

    alt hash unchanged and chunks exist
        P-->>W: {status: "unchanged"}
        Note over P,W: no embedding call, no write
    else new or changed
        P->>PG: UPSERT documents (status=pending, raw_content)
        P->>CH: chunk_text(content, content_type)
        CH-->>P: Chunk[] with heading paths / SQL objects
        P->>E: embed(chunk texts, input_type="document")
        E-->>P: vectors
        P->>PG: BEGIN
        P->>PG: DELETE chunks WHERE document_id
        P->>PG: INSERT chunks (embedding, metadata, tsv generated)
        P->>PG: UPDATE documents SET status='indexed'
        P->>PG: COMMIT
        P-->>W: {status: "indexed", chunk_count}
    end
    W->>PG: UPDATE ingestion_jobs (succeeded/failed)
```

## Idempotency

The key is `(collection, external_id)`; the change detector is `content_hash` over the body **and** the metadata. Re-ingesting unchanged content is a no-op with no embedding call, which is what makes a five-minute poll interval free when nothing changed.

Two consequences worth knowing:

- Chunks are **replaced wholesale**, not diffed. Re-embedding a document is one batched vendor call; a partial-diff chunker would be more code and more ways to leave the index inconsistent.
- Because the hash covers content only, a change to the *chunker itself* does not invalidate anything. After changing chunking logic, re-index deliberately with `POST /v1/collections/{name}/reembed`.

`raw_content` is stored verbatim precisely so re-embedding can re-chunk from the original. Chunk text is lossy — heading paths are prepended and windows overlap — so reconstructing a document by concatenating its chunks would compound that noise on every pass.

## Choosing a chunker

```mermaid
flowchart TD
    D([Document]) --> T{content_type}
    T -->|"text/sql<br/>application/sql"| SQL[chunk_sql]
    T -->|anything else| MD[chunk_markdown]

    SQL --> S1[Scan char by char:<br/>quotes, -- and /* */ comments, $$ bodies]
    S1 --> S2[Split on real statement boundaries]
    S2 --> S3[Pack statements up to the token budget<br/>oversized statement stays whole]
    S3 --> S4[Extract CREATE objects → metadata.sql_objects<br/>prepend them as a comment]

    MD --> M1[Split on the heading tree]
    M1 --> M2{"section ≥<br/>CHUNK_MIN_TOKENS?"}
    M2 -->|yes| M3[Emit alone, context = its heading path]
    M2 -->|no| M4[Merge forward with following sections]
    M4 --> M5[context = deepest SHARED heading<br/>each section keeps its own heading inline]
    M3 --> M6[Pack into windows with overlap]
    M5 --> M6
    M6 --> M7[Prepend the heading path to the text]

    S4 --> OUT([Chunk with content, context, metadata])
    M7 --> OUT

    style SQL fill:#e7f0fb,stroke:#438dd5
    style MD fill:#e7f0fb,stroke:#438dd5
```

Both branches encode a failure they exist to prevent:

**SQL** — a naive `split(';')` breaks on semicolons inside string literals and inside `$$…$$` function bodies, which is most of a Postgres migration. A half `CREATE FUNCTION` retrieves as plausible SQL and is not runnable — worse during an incident than retrieving nothing.

**Markdown** — merged sections are labelled with the deepest heading they *share*, never the first one's. Labelling "never restart the primary database" as `Symptom` is how a runbook tells an operator the wrong thing about the wrong procedure.

The heading path is prepended to the embedded text because a chunk reading "restart the pods" is meaningless without knowing which service section it came from, and the embedding has no other way to learn that.

## Metadata inheritance

Document metadata is merged into every chunk's metadata at ingest time, plus `collection`, `external_id`, `source_type` and `title`. That is why one containment filter covers both levels:

```sql
WHERE c.metadata @> '{"service": "payments-api", "severity": "P1"}'::jsonb
```

with a single GIN index on `chunks.metadata`, and no join to `documents` for filtering.

## Failure handling

| Failure | Recorded where | Result |
|---|---|---|
| Document produces no chunks | `documents.status='failed'`, `error` | Job marked failed |
| Embedding call fails | `documents.status='failed'`, `error` | Job failed; arq retries up to `JOB_MAX_ATTEMPTS` |
| Queue unreachable | Response field `degraded` | Ingested synchronously instead |
| Collection missing | HTTP 404 | Nothing written |

A failed document keeps its previous chunks: the `DELETE`/`INSERT` pair is inside one transaction, so the index never has a half-rewritten document.

---

Next: [source polling](source-polling.md)
