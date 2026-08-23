# RAG Core — grounded retrieval for incident response

**A retrieval service that refuses to guess.**

Agents resolving a production incident need answers from *your* runbooks, *your*
postmortems, *your* SQL — with a citation for every claim, and a flat refusal
when the corpus cannot support one. A confident wrong procedure at 3am costs
more than no procedure.

This is the retrieval layer for that. It is not an agent framework: orchestration
stays outside, and everything that touches a model goes through four independent
guardrails.

---

## The 90-second demo

```bash
cp .env.example .env      # set OPENAI_API_KEY (or ANTHROPIC_API_KEY)
make secrets-key          # → paste SECRETS_KEY into .env
make up && make ui && make seed
open http://localhost:8000        # key: rag_sk_local_dev_key
```

Then, in this order — it builds to the point:

**1 · `/search` — prove retrieval is real.** Search `ERR_UPSTREAM_TIMEOUT`.
Every result carries a four-bar breakdown: vector, lexical, RRF, rerank. This
screen exists to make one silent failure visible — if every bar for *lexical*
is empty, the full-text branch has stopped contributing and hybrid search has
degraded to vector-only **without erroring**.

**2 · `/ask` — watch the guardrails fire.** Ask *"checkout is timing out after
the deploy"* under incident `INC-2481`. Sources render **before** the first
token, the answer streams with `[1] [2]` chips that jump to the passage, and
the footer shows `confidence 0.54 · grounded 1.00 · 2 citations`.

The answer is the interesting part: it says **check pgbouncer `cl_waiting`
before scaling the API** — because INC-2481 is 42 minutes of evidence that
scaling the API first makes it worse. The obvious action is the wrong one, and
the corpus knows.

**3 · Now ask something it cannot know.** *"Which Kubernetes version does
production run?"* You get an abstention banner, not an answer and not an error.
No model call happened.

**4 · `/setup` — connect a source live.** Pick *Git repository*, paste a public
repo URL, press **Test connection**. It answers `'main' resolves to f5c30d04`
— or tells you the branch does not exist and lists the ones that do. Save,
**Sync now**, and the run history shows `ok · 18339ms · 9 docs`.

**5 · `/metrics` — pin the trace.** Load the `query_log_id`, see all 8 retrieved
passages with scores and the judge's reasoning in prose, and press **Pin**.

---

## Where it sits in a multi-agent system

```
┌─ Orchestration app ─┐   ┌─  RAG CORE  ─┐   ┌─ Codegen agent ─┐   ┌─ PR viewer ─┐
│ receives the        │──▶│ /search      │   │ implements      │   │ shows the   │
│ incident, decides   │◀──│ /answer      │──▶│ opens the PR    │──▶│ PR + WHY    │
└─────────────────────┘   └──────────────┘   └─────────────────┘   └─────────────┘
                                  │                                       ▲
                                  └────── /incidents/{id}/traces ─────────┘
```

We orchestrate nothing, and that is the point. The boundary is what makes the
four guardrails apply identically to every caller — REST, SSE, MCP or webhook.

**The handoff to the PR is a first-class output:**

```bash
make justify INC=INC-2481 PR=https://github.com/acme/api/pull/4711
```

Renders the incident's traces as a markdown block for the PR body — answers,
citations with relevance, the judge's verdict *and its reasoning*, plus a
**"Not covered by the knowledge base"** section listing what the service refused
to answer. Then it **pins** those traces so the links survive.

That block is the evidence the service retrieved and validated — deliberately
not the agent's summary of it. The gaps are what a reviewer needs most, and an
agent narrating its own reasoning is exactly where they disappear.

---

## The four guardrails

Ordered by how much they actually buy you.

| # | Layer | What it catches |
|---|---|---|
| 1 | **Confidence gate** | Most hallucinations are a model asked a question the corpus cannot answer. Below `MIN_CONTEXT_SCORE` the API abstains and **never calls the model**. |
| 2 | **Citation validation** | Every `[n]` is resolved back to a real chunk id. A marker outside the supplied range is stripped and reported — a fabricated source cannot reach the caller as a real one. |
| 3 | **Groundedness judge** | A second model checks each claim against the passages and returns a schema-forced verdict with reasoning. |
| 4 | **Trace + feedback** | Query, passages, answer and verdict persist. Agents rate what actually helped, which feeds back into ranking. |

**Abstention is a 200, not a 4xx.** A caller gets the retrieved sources either
way and decides what to do. An error status pushes agents toward retry logic and
their own model knowledge — precisely the behaviour these layers exist to
prevent.

---

## Engineering that a demo will not show you

Every item here is a bug that was *found and fixed*, or a decision whose
alternative fails silently. Silent failure is the theme: this domain is full of
systems that look healthy while being wrong.

### The lexical branch was returning nothing

`websearch_to_tsquery` **ANDs** every term. A five-word question matched zero
documents, so hybrid search degraded to vector-only — with no error, no warning,
and plausible-looking results. Fixed by OR-ing the lexemes. The four-bar
breakdown on `/search` exists so this can never hide again.

### The abstention gate was decorative

Confidence was derived from the RRF fusion score. RRF is **rank-based**, so the
top hit of any search scores near maximum no matter how irrelevant the corpus
is — the threshold could never fire. Confidence now reads a real similarity
signal: rerank, else cosine, else lexical.

### The threshold was a guess, and the guess was wrong

`make eval` scores twelve golden questions and reports the confidence of
answerable questions against unanswerable ones:

```
answerable_min      0.5308
unanswerable_max    0.4273
gap                 0.1035     ← the threshold belongs here
suggested           0.479
```

The threshold was `0.35`. Three of four out-of-corpus questions — including one
phrased as an invented incident id, `INC-9999` — cleared the gate and reached
the model.

They were answered safely anyway (*"the passages do not contain information
about…"*), because layer 2 held. **That is the model choosing to behave, not the
guarantee layer 1 is supposed to provide** — and it is why a guardrail propped
up by the next one down still looks like a working guardrail. At `0.48`:
12/12 abstention decisions correct.

### An editable prompt can break everything while reporting success

Save an `answer_template` without `{context}` and it **still renders**. The
model receives no passages and answers from its own knowledge — while citation
validation and the judge keep reporting success, because both check against a
context that was never sent. Every guardrail shows green.

So it is rejected on write, with 422. The same check catches a prompt containing
a JSON example (`{"ok": true}`), which would otherwise raise `KeyError` inside
`str.format()` during a real incident.

### Chunks were labelled with the wrong heading

Small merged sections inherited the **first** section's heading, so *"never
restart the primary database"* was filed under `Symptom`. Merged chunks now
carry the deepest **shared** heading.

### Connector forms are generated, not written

Each connector declares its own fields; `GET /v1/source-types` serves them and
the UI renders from that. The alternative — one hardcoded form per connector —
means a backend change *and* a frontend change in a different language, and they
drift the first time a field is renamed. Silently: a form writing `config.token`
against a connector reading `config.api_token` produces an empty credential, not
an error.

### Test connection checks more than authentication

A valid Slack token whose bot was never `/invite`d. A JQL nobody can parse. An
`items_path` resolving to nothing. Each produces a source that runs **green and
indexes zero documents** — the hardest failure to notice. The probe reports
them at save time instead of an interval later.

### Secrets are encrypted, and the name is authenticated

AES-256-GCM under `SECRETS_KEY`, with the secret's name as associated data — so
a ciphertext copied into another row fails to decrypt rather than silently
becoming a different token. A key fingerprint per row turns a rotated
`SECRETS_KEY` into a clear error rather than a corrupt value surfacing as a
vendor 401 days later. **No endpoint returns a plaintext secret**; the last four
characters are all the API will ever emit.

### A PR's justification outlives the trace it links to

Traces are pruned after 30 days; a merged PR lives in git forever. Pinning
exempts a trace, and `make justify` pins everything it cites. The markdown
snapshot and the live link are not redundant — the snapshot is what a reader
sees in a year, the link gives the full eight-passage context while it exists.

---

## Under the hood

**Hybrid retrieval in one SQL statement.** pgvector HNSW (cosine) and Postgres
full-text (`tsvector`) fused by **Reciprocal Rank Fusion**. RRF reads *ranks*,
not scores — which sidesteps calibrating two incomparable scales, a
normalization that silently rots as the corpus changes.

**Provider-agnostic by construction.** Every model call goes through one of
three interfaces. No module outside `app/providers/` imports a vendor SDK, so
swapping Anthropic ↔ OpenAI ↔ Ollama is a config change. Verified: the whole
stack was migrated to OpenAI mid-build without a schema change, using
Matryoshka dimension reduction to fit `vector(512)`.

**Structure-aware chunking.** Markdown follows the heading tree. SQL gets its
own splitter that respects quotes, `--` / `/* */` comments and `$$` bodies, and
indexes the objects each statement defines as filterable facets.

**Documents are chosen deliberately, because the obvious unit is wrong.**
Slack indexes **threads**, not messages — *"yeah that fixed it"* is meaningless
alone. CloudWatch indexes **fingerprinted patterns**, not lines — a busy service
emits the same timeout ten thousand times an hour, and you want *"12 distinct
failure modes by frequency"*, not 10,000 near-duplicate embeddings competing for
top-k. Jira keeps the **comments**, because that is where the fix lives.

**Ingestion is idempotent** on `(collection, external_id, content_hash)`, so
replaying a feed every five minutes costs nothing.

---

## Eight connectors

| Type | Indexes | Cursor |
|---|---|---|
| `filesystem` | A mounted directory | file mtime |
| `git_repo` | SQL, migrations, IaC, docs | commit SHA + `git diff` |
| `jira` | Tickets **with comments** | `updated` watermark |
| `slack` | **One document per thread** | newest thread ts |
| `confluence` | Wiki pages | `lastmodified` |
| `aws_logs` | CloudWatch, **as failure patterns** | window end |
| `http_json` | Any JSON endpoint | configurable param |
| `mcp` | A tool on an **external** MCP server | optional `since` |

`git_repo` diffs by commit SHA, not mtime — a fresh clone rewrites every mtime,
so an mtime cursor re-embeds the whole repo on any clean checkout.

The `mcp` connector is the escape hatch: GitHub, Sentry and Linear all ship MCP
servers, and pointing at one beats writing a connector each time.

---

## MCP, in both directions

**Agents consuming us.** A thin stdio client over the REST API — same tools,
same guardrails, so an agent cannot reach retrieval by a path that skips the
confidence gate. `/setup` → **MCP** generates the config block with your origin
and key filled in.

```
rag_search             required=['query']
rag_answer             required=['query', 'incident_id']
rag_ingest             required=['collection', 'external_id', 'content']
rag_feedback           required=['rating']
rag_list_collections   required=None
rag_pin_trace          required=['query_log_id', 'reason']
rag_incident_traces    required=['incident_id']
```

`incident_id` is in `required` on purpose — it makes the whole investigation
replayable, and the schema enforces it before a call can fail.

**Us consuming vendors.** The `mcp` connector. Leave the tool name blank, press
**Test connection**, and it lists what the server exposes — MCP tool names are
rarely guessable.

**The behavioural contract lives in the tool descriptions**, because a schema
cannot express it: *`abstained: true` means "not in the knowledge base", not
"the call failed."* An agent that treats it as an error and falls back to its
own weights has defeated everything above.

---

## Four ways in

REST · SSE streaming · MCP · webhook callback for long investigations. All the
same guardrails.

---

## Numbers

| | |
|---|---|
| Connectors | 8 |
| REST endpoints | 35 |
| Python | ~9,200 lines |
| Frontend | ~3,150 lines (React + Vite + TS, no UI kit, no state library) |
| Tests | 58 |
| Docs | 18 documents, 21 Mermaid diagrams, all parser-validated |
| Eval | recall@k 1.0 · MRR 1.0 · abstention 12/12 · groundedness 1.0 |
| Answer latency | ~5.2s end to end, including the judge |

---

## Honest limits

A jury deserves these stated rather than discovered.

- **The golden set is 12 questions over 9 documents.** Recall of 1.0 says
  retrieval is not broken; it does not say it scales. As the corpus grows,
  recall will fall from 1.0 the moment passages genuinely compete — expected,
  not a regression. The numbers to keep trusting are the calibration gap and the
  abstention counts.
- **The API key lives in the browser's localStorage.** Fine for a demo or an
  internal tool. A public deployment needs a session-cookie BFF; obfuscating it
  client-side would be theatre.
- **CORS is wide open** and the compose file is local-only — no TLS, no
  replicas, no backups.
- **No per-tenant isolation.** Collections and metadata filters are the current
  boundary; Postgres RLS is the real answer and is not built.
- **The UI was verified by API, not by eye.** Every endpoint it calls is tested
  and it type-checks and builds clean, but Chrome could not load `localhost` in
  the build environment, so the rendering itself is unverified.

---

## Reading further

| | |
|---|---|
| [docs/](docs/README.md) | C4 diagrams, flows, ADRs |
| [docs/setup.md](docs/setup.md) | Connectors, the secret vault, versioned prompts, MCP |
| [docs/anti-hallucination.md](docs/anti-hallucination.md) | The four layers and what each is blind to |
| [docs/evaluation.md](docs/evaluation.md) | The golden set and how the threshold is derived |
| [docs/decisions.md](docs/decisions.md) | 22 ADRs — the choices you would otherwise undo by accident |
| [README.md](README.md) | Technical quick start and API reference |

The ADRs are the ones to read if you are going to touch this. Every entry says
what breaks if you revert it — because most of these choices look arbitrary
until the thing they prevent happens.
