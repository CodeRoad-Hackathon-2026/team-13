# RAG Core

Provider-agnostic RAG service over **PostgreSQL + pgvector**, built for incident-response agents.

Hybrid retrieval (vector + full-text, fused with RRF), cross-encoder reranking, and grounded generation with **mandatory citations, confidence-based abstention, and an LLM groundedness judge**.

> **New here, or judging this?** Start with **[HACKATHON.md](HACKATHON.md)** — the pitch, a 90-second demo script, and the engineering decisions a demo will not show you. This file is the technical reference.

```
                 ┌───────────────────────────────────────────────┐
  agents ──────► │  REST API  /search /answer /documents /feedback│
                 └───────────────┬───────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  ┌───────────┐          ┌──────────────┐         ┌──────────────┐
  │ retrieval │          │  generation  │         │  ingestion   │
  │ vector ─┐ │          │  cite + judge│         │ chunk→embed  │
  │ lexical ┴─► RRF ─► rerank           │         │   →upsert    │
  └─────┬─────┘          └──────┬───────┘         └──────▲───────┘
        │                       │                        │
        ▼                       ▼                        │
  ┌──────────────────────────────────────┐        ┌──────┴───────┐
  │  PostgreSQL + pgvector               │        │ worker + cron│
  │  chunks(embedding, tsv) · traces     │        │ (arq/Redis)  │
  └──────────────────────────────────────┘        └──────────────┘
```

---

## Quick start

```bash
cp .env.example .env       # then set your keys
make secrets-key           # → SECRETS_KEY=… paste it into .env
make up                    # postgres + redis + api + worker
make ui                    # build the web UI
make seed                  # demo runbooks and incidents
open http://localhost:8000        # web UI
open http://localhost:8000/docs   # OpenAPI
```

Connect Slack, Jira, GitHub or an MCP server from **`/setup`** — the forms are
generated from each connector's own schema, credentials are encrypted, and
**Test connection** runs against the real vendor before you save. See
[docs/setup.md](docs/setup.md).

**Architecture, flows and design decisions: [docs/](docs/README.md)** — C4
diagrams, the query flow, and the ADRs behind the non-obvious choices.

```bash
curl -X POST localhost:8000/v1/answer \
  -H "X-API-Key: $BOOTSTRAP_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"checkout is timing out after the deploy","incident_id":"INC-1"}'
```

The stack boots with **no vendor key at all** if you set `EMBEDDING_PROVIDER=hash`, `RERANK_PROVIDER=none`, `GROUNDEDNESS_CHECK=false` — useful for wiring demos offline. `hash` embeddings are a plumbing stub with no semantics; use a real provider for anything you care about.

> Host ports default to **55432** (Postgres) and **56379** (Redis) to avoid colliding with other local stacks. Override with `POSTGRES_PORT` / `REDIS_PORT` / `API_PORT`.

---

## Swapping providers

Every model call goes through one of three interfaces in `app/providers/base.py`. Changing vendor is a config change, never a code change:

| Kind | Setting | Options |
|---|---|---|
| Embeddings | `EMBEDDING_PROVIDER` | `voyage`, `openai`, `ollama`, `hash` |
| Generation | `LLM_PROVIDER` | `anthropic`, `openai`, `ollama` |
| Reranking | `RERANK_PROVIDER` | `voyage`, `cohere`, `llm`, `none` |

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIM=1024
OPENAI_API_KEY=sk-...
```

**Changing the embedding model requires a re-embed** — vectors from two models are not comparable and mixing them silently destroys recall:

```bash
curl -X POST localhost:8000/v1/collections/runbooks/reembed -H "X-API-Key: $KEY"
```

Adding a provider = one class implementing `EmbeddingProvider` / `LLMProvider` / `RerankProvider`, plus one line in its `build_*` factory.

### Measure time-to-first-token before committing to a model

Model choice is not just quality and price. On this corpus, the same prompt
measured wildly different TTFT across OpenAI models:

| Model | TTFT | Total |
|---|---|---|
| `gpt-4o` | 1.1s | 2.1s |
| `gpt-4.1-mini` | 0.7s | 3.3s |
| `gpt-5` | 5.7s | 6.2s |
| `gpt-4.1` | **29.2s** | 32.1s |

`gpt-4.1` was reproducibly ~30x slower — and only with this exact system
prompt: an unrelated prompt of the same shape was fast, the same prompt was
fast on `gpt-4o` and `gpt-4.1-mini`, and deleting a single blank line from it
made `gpt-4.1` fast too. That is an upstream artifact, not something this code
does; it is recorded here so the next person does not spend an hour on it.

The lesson is the method, not the table: **measure TTFT with your real prompt
and your real context before picking a model**, because a pathology like this
is invisible in a benchmark and dominates the demo.

---

## Retrieval

Two branches run in one SQL statement (`app/retrieval/hybrid.py`), fused with Reciprocal Rank Fusion, then reranked.

Incident questions mix fuzzy description ("checkout is slow since the deploy") with exact tokens (`ERR_CONN_RESET`, `payments-svc`, `ORA-01555`, a commit SHA). Dense vectors handle the first and are unreliable on the second; lexical search is the reverse. RRF combines them by **rank**, so the two incomparable score scales never need calibrating.

Two details that matter more than they look:

- **The lexical branch ORs its terms.** `websearch_to_tsquery` ANDs them, so one absent word excludes an otherwise perfect chunk and hybrid search silently degrades to vector-only. `ts_rank_cd` then does the discriminating.
- **Confidence is not the RRF score.** RRF is rank-based, so the top hit of any search scores near maximum no matter how irrelevant the corpus is. The abstention gate reads reranker score → cosine similarity → lexical rank, in that order (`confidence_of` in `app/rag/answer.py`).

Tune with `RETRIEVAL_CANDIDATES`, `RERANK_CANDIDATES`, `RETRIEVAL_TOP_K`, `RRF_K`, `VECTOR_WEIGHT`, `LEXICAL_WEIGHT`.

---

## Anti-hallucination

Four independent layers, ordered by how much they actually buy you:

1. **Confidence threshold** (`MIN_CONTEXT_SCORE`) — if nothing retrieved clears it, the API abstains and never calls the model. Most hallucinations are a model being asked a question the corpus cannot answer.
2. **Citation validation** — every `[n]` is resolved back to a real chunk id. Markers outside the supplied range are a fabricated source: they are stripped and reported in `warnings`.
3. **Groundedness judge** (`GROUNDEDNESS_CHECK`) — a second, structured-output model call scores each claim against the passages and returns `{score, verdict, unsupported_claims}`.
4. **Trace + feedback** — every query, chunk, answer and verdict is persisted; agents post `/feedback`, which multiplicatively adjusts fusion score on later searches.

A response always tells you what happened:

```json
{
  "answer": "Scale pgbouncer before scaling the API [1]...",
  "abstained": false,
  "confidence": 0.71,
  "citations": [{"marker": 1, "chunk_id": "...", "external_id": "runbook/payments-timeout"}],
  "groundedness": {"score": 0.92, "verdict": "grounded", "unsupported_claims": []},
  "warnings": []
}
```

---

## Feeding the index

**Push** — anything can POST documents; this is the generic path every connector lands on:

```bash
curl -X POST localhost:8000/v1/documents -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "documents": [{
    "collection": "incidents",
    "external_id": "INC-2481",
    "title": "Checkout 5xx spike",
    "content": "# Postmortem\n...",
    "metadata": {"service": "payments-api", "severity": "P1"}
  }]
}'
```

Ingestion is idempotent on `(collection, external_id, content_hash)`, so replaying the same feed every five minutes costs nothing.

**Pull** — register a source and the scheduler polls it on an interval, tracking a cursor so only changes are re-embedded:

```bash
curl -X POST localhost:8000/v1/sources -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "collection": "runbooks", "name": "local-runbooks", "type": "filesystem",
  "config": {"path": "/data/runbooks", "include": ["**/*.md"]},
  "interval_seconds": 300
}'
```

### Connectors

| Type | Indexes | Incremental cursor |
|---|---|---|
| `filesystem` | A mounted directory | file mtime |
| `git_repo` | SQL, migrations, IaC, docs in git | commit SHA + `git diff` |
| `jira` | Resolved tickets **with their comments** | `updated` watermark (JQL) |
| `slack` | Incident channels, **one document per thread** | newest thread ts |
| `confluence` | Wiki pages | `lastmodified` watermark (CQL) |
| `aws_logs` | CloudWatch, **collapsed into failure patterns** | window end timestamp |
| `http_json` | Any JSON endpoint, dotted-path mapping | configurable param |
| `mcp` | A tool on an **external** MCP server (GitHub, Sentry, Linear) | optional `since` argument |

Three of these make a deliberate choice about **what a document is**, because the obvious answer is wrong:

- **Slack indexes threads, not messages.** A message reading "yeah that fixed it" is meaningless alone, and retrieving it mid-incident is worse than retrieving nothing. A thread is the smallest unit carrying a whole symptom → diagnosis → fix arc.
- **CloudWatch indexes patterns, not lines.** A busy service emits the same timeout line ten thousand times an hour. Each event is normalized into a fingerprint (numbers, UUIDs, IPs, paths, timestamps replaced by placeholders) and grouped, so a poll yields "12 distinct failure modes ranked by frequency" instead of 10,000 near-duplicate embeddings competing for top-k.
- **Jira keeps the comments.** The fix is usually in the comment thread, not the description.

`git_repo` diffs by commit SHA rather than mtime — a fresh clone rewrites every mtime, so an mtime cursor would re-embed the whole repo on any runner starting from a clean checkout. Deletions in the diff remove the document instead of leaving a stale one in the index. SQL files are routed to a SQL-aware chunker that splits on real statement boundaries (respecting quotes, `--`/`/* */` comments and `$$` bodies) and indexes the objects each chunk defines as filterable facets.

**Secrets never go in `config` as plaintext.** Any value written `${NAME}` resolves at poll time from the encrypted vault first and the worker's environment second — so a token can be pasted in the UI or set in `.env`, with the same syntax either way. Nothing readable is stored in Postgres and nothing comes back out of `GET /v1/sources`. A missing name fails the run loudly instead of producing a confusing 401 inside a vendor client.

**Test before saving.** `POST /v1/sources/test` runs the config against the real vendor and reports what is wrong — a bot that was never invited to the channel, a JQL that does not parse, a path that was never mounted into the worker. The alternative is reading `last_error` an interval later.

```bash
curl -X POST localhost:8000/v1/sources -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "collection": "incidents", "name": "jira-ops", "type": "jira",
  "config": {
    "base_url": "https://acme.atlassian.net",
    "email": "bot@acme.com", "api_token": "${JIRA_API_TOKEN}",
    "jql": "project = OPS AND statusCategory = Done",
    "custom_fields": {"severity": "customfield_10032"}
  },
  "interval_seconds": 900
}'
```

Adding a vendor is one function returning `(documents, cursor)` plus a `@register(...)` decorator that also declares the connector's form fields — `GET /v1/source-types` serves them, so the setup UI builds the form without a matching frontend change. See [docs/sources.md](docs/sources.md) for every connector's config.

The `mcp` connector is the general escape hatch: GitHub, Sentry and Linear all ship MCP servers, and pointing at one is less work than writing a connector. Note it runs the command **inside the worker container** — `npx` is not there by default.

**Why a worker and not `pg_cron`:** ingestion is IO-bound on external APIs, needs retries and backoff, and must not hold a database connection while waiting on a vendor. The schedule lives in Postgres (`sources.interval_seconds`), so intervals change at runtime without redeploying.

---

## API

| Method | Path | Scope | Purpose |
|---|---|---|---|
| `GET` | `/v1/health` | — | Liveness + resolved providers |
| `POST` | `/v1/collections` | write | Create a collection |
| `POST` | `/v1/collections/{name}/reembed` | admin | Re-embed after a model change |
| `POST` | `/v1/documents` | write | Ingest (async by default) |
| `DELETE` | `/v1/documents/{collection}/{external_id}` | write | Remove a document |
| `GET` | `/v1/jobs/{id}` | read | Ingestion job status |
| `POST` | `/v1/search` | read | Retrieval only, no LLM tokens |
| `POST` | `/v1/answer` | read | Grounded answer (`callback_url` → 202 + webhook) |
| `POST` | `/v1/answer/stream` | read | SSE: `sources` → `delta`* → `final` → `done` |
| `GET` | `/v1/answer/{request_id}` | read | Poll an async answer |
| `POST` | `/v1/feedback` | read | Rate a chunk (feeds ranking) |
| `GET` | `/v1/traces/{query_log_id}` | read | Full trace of one query |
| `POST` | `/v1/sources` | write | Register a polled source |
| `POST` | `/v1/sources/{id}/sync` | write | Poll now |
| `POST` | `/v1/admin/api-keys` | admin | Issue a key |
| `GET` | `/v1/admin/stats` | admin | Corpus + answer-quality counters |

Auth is `X-API-Key` with `read` / `write` / `admin` scopes and a per-key rate limit. `BOOTSTRAP_API_KEY` is registered as an admin key on startup.

**Agent integration note:** `/search` is what an agent should call when it wants evidence to reason over itself — no LLM tokens are spent. `/answer` is for when it wants prose plus a verified groundedness verdict. On SSE, deltas are unverified by construction: citation validation and the judge run on the assembled answer and arrive in `final`.

---

## MCP server

Exposes the service as agent tools over stdio. It is a thin client over the REST API, not a second implementation — every guardrail stays behind the API, and MCP calls land in the same traces as HTTP calls.

```bash
pip install mcp
RAG_API_URL=http://localhost:8000/v1 RAG_API_KEY=$KEY python -m app.mcp_server
```

Claude Code / Claude Desktop:

```json
{
  "mcpServers": {
    "rag": {
      "command": "python",
      "args": ["-m", "app.mcp_server"],
      "cwd": "/path/to/hackaton",
      "env": {
        "RAG_API_URL": "http://localhost:8000/v1",
        "RAG_API_KEY": "rag_sk_..."
      }
    }
  }
}
```

| Tool | Use |
|---|---|
| `rag_search` | Passages only, no LLM tokens — when the agent wants evidence to reason over itself |
| `rag_answer` | Grounded answer with citations, confidence and groundedness verdict |
| `rag_ingest` | Write back what an investigation learned (idempotent on `external_id`) |
| `rag_feedback` | Rate a passage; feeds the ranking |
| `rag_list_collections` | Discover how the knowledge base is organized |

The tool descriptions carry the behavioural contract an agent needs — notably that `abstained: true` means "not in the knowledge base", not "call failed", so the agent should say so rather than quietly substituting its own knowledge.

## Layout

```
app/
  providers/     base.py (contracts) · embeddings.py · llm.py · rerank.py
  ingestion/     chunking.py · pipeline.py
    sources/     __init__.py (registry) · filesystem · git_repo · jira
                 slack · confluence · aws_logs · http_json
  retrieval/     hybrid.py          — the fusion SQL
  rag/           prompts.py · answer.py  — guardrails
  api/routes.py  mcp_server.py  worker.py  security.py  db.py  config.py
db/migrations/   001_init.sql
```

Chunking is structure-aware: it splits on the markdown heading tree, packs sections into token windows with overlap, and labels each chunk with its heading path. Sections too small to stand alone merge — but a merged chunk is labelled with the **deepest heading its sections share**, never the first one's. Labelling "never restart the primary database" as `Symptom` is how a runbook tells an operator the wrong thing.

---

## Operations

```bash
make logs      # tail api + worker
make psql      # database shell
make test      # unit tests
make reset     # drop the volume and start clean
```

- `query_logs` and `source_runs` are pruned to `TRACE_RETENTION_DAYS` (30) by a nightly cron job. **Pinned traces are exempt** — pin any trace a PR or postmortem links to, or that link 404s a month later.
- The worker hot-reloads in dev via `watchfiles`; **remove that wrapper in production**.
- Redis is a degraded-mode dependency: without it the API still answers and ingests synchronously, it just cannot queue background work or rate-limit.
- CORS is wide open for the demo — restrict `allow_origins` before exposing this anywhere real.

## Web UI

Five screens, served by the API at `/`:

| Screen | Shows |
|---|---|
| **Ask** | Streamed answer, citation chips that jump to the passage, confidence, groundedness verdict, abstention banner, per-source feedback |
| **Search** | Retrieval only, with a vector / lexical / RRF / rerank score breakdown per result |
| **Corpus** | Collections, source health, manual sync, paste-a-document ingest |
| **Setup** | Connector catalog with generated forms and Test connection, poll schedule and run history, the encrypted secret vault, versioned prompts, MCP config in both directions |
| **Metrics** | Abstention rate, groundedness, latency, feedback, and a trace viewer with pinning |

`make ui` builds it; `make ui-dev` runs Vite with hot reload on `:5173`.
Details in [docs/frontend.md](docs/frontend.md).

## Agents

`agents/` ships a CrewAI incident-response crew (triage → investigator →
remediation) that consumes this service through the same public API as any
other caller — so the confidence gate, citation validation and groundedness
judge all still apply.

```bash
pip install -r agents/requirements.txt
make crew Q="checkout is timing out after the deploy"   # --dry-run, no LLM needed
make justify INC=INC-2481 PR=https://github.com/acme/api/pull/4711
```

`make justify` is the handoff to whatever opens the pull request: it renders an
incident's traces as a markdown block — answers, citations with relevance, the
judge's verdict and reasoning, and a **Not covered by the knowledge base**
section listing what the service refused to answer — then **pins** those traces
so the links outlive the retention window. A crew run prints it automatically.

What it emits is the evidence the service retrieved and validated, not the
agent's restatement of it. The gaps are the part a reviewer needs most, and an
agent narrating its own reasoning is exactly where they disappear.

CrewAI is deliberately a **consumer**, never a component: it carries its own
LLM layer (litellm), which would break the provider-agnostic design if it were
inside the service. See [agents/README.md](agents/README.md) and
[docs/decisions.md](docs/decisions.md#no-agent-framework-inside-the-core).

## Evaluation

```bash
make eval                                          # retrieval + generation
python -m eval.run --key $KEY --retrieval-only     # no model tokens
```

Twelve golden questions scoring recall@k, MRR, abstention correctness,
groundedness and whether required facts survive into the answer. Non-zero exit
on a failed gate, so it drops into CI unchanged.

Its most useful output is the **calibration gap** — the confidence of
answerable questions against unanswerable ones. `MIN_CONTEXT_SCORE` belongs in
that gap, and this is the only thing that says where the gap is. It found the
threshold was too low on its first run: at 0.35, three of four out-of-corpus
questions passed the gate and reached the model. Measured gap is
[0.427, 0.531]; the threshold is now 0.48 and abstention is 12/12.

Re-derive it whenever the embedding model or the corpus changes.
[docs/evaluation.md](docs/evaluation.md).

## Not built yet

- PagerDuty / ServiceNow / Datadog connectors (the `http_json` connector covers most of these today).
- Per-tenant isolation via Postgres RLS (collections + metadata filters are the current boundary).
