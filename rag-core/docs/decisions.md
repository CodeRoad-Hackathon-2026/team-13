# Decisions

Choices a reader would otherwise undo by accident. Each one records what was decided, why, and what breaks if it is reverted.

---

## RRF over score normalization

**Decided:** fuse the vector and lexical branches with Reciprocal Rank Fusion, reading ranks rather than scores.

**Why:** the branches return incomparable scales — cosine similarity in `[-1, 1]` versus `ts_rank_cd`, which is unbounded and corpus-dependent. Normalizing them into a comparable range requires calibration that drifts as the corpus grows. Ranks need no calibration.

**If reverted:** ranking quality becomes a function of how recently someone re-tuned the normalization constants.

---

## The lexical branch ORs its lexemes

**Decided:** build the tsquery as `lexeme1 | lexeme2 | …` instead of using `websearch_to_tsquery`.

**Why:** `websearch_to_tsquery` and `plainto_tsquery` AND every term, so a single word absent from a chunk excludes it. For "checkout timing out ERR_UPSTREAM_TIMEOUT pgbouncer", nothing in the corpus contained all five, the lexical branch returned zero rows, and hybrid search silently degraded to vector-only.

**Why it is dangerous:** there is no error. Search keeps working and results stay plausible; the exact-token half of every query is just gone. The `retrieval_mode` badge exists so this is visible — if every result says `vector`, the lexical branch has stopped contributing.

**If reverted:** identifiers, error codes and service names stop matching, which is most of what makes retrieval useful during an incident.

---

## Confidence is not the RRF score

**Decided:** `confidence_of()` reads reranker score → cosine similarity → lexical rank. Never RRF.

**Why:** RRF is rank-based, so the top hit of any search scores near the maximum — including a search over a corpus containing nothing relevant. A threshold on RRF can never fire.

**Consequence if reverted:** the abstention gate looks implemented, passes code review, and never triggers. Every out-of-corpus question reaches the generator. This was a real bug, found only by asking something the corpus could not answer and watching it produce a confident reply.

Related: ranking still uses `rerank ?? rrf`. "Which of these is best" and "is the best one good enough" are different questions; RRF answers only the first.

---

## Slack indexes threads, not messages

**Decided:** one document per thread, dropping threads shorter than `min_messages`.

**Why:** a message reading "yeah that fixed it" carries no information alone, and retrieving it mid-incident is worse than retrieving nothing. A thread is the smallest unit containing a whole symptom → diagnosis → fix arc.

**If reverted:** the index fills with conversational fragments that match well and mean nothing.

---

## CloudWatch indexes patterns, not lines

**Decided:** normalize each event into a fingerprint (timestamps, UUIDs, IPs, hex ids, paths, quoted strings and numbers → placeholders), group by fingerprint within the polling window, and emit one document per distinct pattern with an occurrence count and sample lines.

**Why:** a busy service emits the same timeout line ten thousand times an hour. Embedding each one costs real money, floods the index with near-duplicates, and pushes genuinely distinct evidence out of the top-k. Retrieving "connection timeout" fifty times tells an agent nothing the first hit did not.

**Effect:** a poll yields "12 distinct failure modes ranked by frequency" instead of 10,000 near-identical embeddings. The fingerprint is stable across windows, so one failure mode keeps one identity over time.

---

## Jira keeps the comments

**Decided:** render description *and* comment thread into the document.

**Why:** in a resolved ticket the fix is usually in the comments; the description is the symptom. Indexing only the description indexes only the half you already know when you go looking.

---

## `git_repo` diffs by commit SHA, not mtime

**Decided:** cursor is the commit SHA; changed files come from `git diff --name-status old..HEAD`.

**Why:** a fresh clone rewrites every file's mtime, so an mtime cursor re-embeds the entire repository on any runner that starts from a clean checkout — every poll, forever, on ephemeral CI-style workers.

**Bonus:** the diff also reports deletions, so a removed file is removed from the index instead of lingering as a stale document.

---

## Merged chunks are labelled with the deepest *shared* heading

**Decided:** when small sections merge, the chunk's heading path is the common ancestor of the merged sections, and each section keeps its own heading inline in the text.

**Why:** the naive merge inherits the *first* section's path. That labels "never restart the primary database" as `Symptom` — telling an operator the wrong thing about the wrong procedure. Content misattribution in a runbook is a safety problem, not a formatting one.

---

## SQL gets its own chunker

**Decided:** `.sql` content routes to a character-scanning splitter that respects quotes, `--` and `/* */` comments, and `$$…$$` bodies.

**Why:** `split(';')` breaks on semicolons inside string literals and inside Postgres function bodies — which is most of a migration file. A half `CREATE FUNCTION` retrieves as plausible SQL and is not runnable.

---

## Worker + queue, not `pg_cron`

**Decided:** an arq worker on Redis, with the schedule stored in `sources.interval_seconds`.

**Why:** ingestion is IO-bound on external APIs, needs retries and backoff, and must not hold a database connection while waiting on a vendor. Keeping the schedule in a table means intervals change through the API at runtime instead of requiring a redeploy.

**Trade-off accepted:** Redis becomes a dependency — a soft one. Without it the API still answers and ingests synchronously; only background work and rate limiting stop.

---

## Providers behind three interfaces

**Decided:** every vendor call goes through `EmbeddingProvider`, `LLMProvider` or `RerankProvider`. No module outside `app/providers/` imports a vendor SDK or knows a vendor name.

**Why:** swapping vendors is a `.env` change instead of a refactor, and the retrieval and generation code stays testable with a stub.

**Invariant to protect:** the moment a vendor name appears in `app/rag/` or `app/retrieval/`, this property is gone.

---

## No agent framework inside the core

**Decided:** the groundedness judge and the LLM reranker are direct provider calls. CrewAI lives in `agents/`, as a consumer, with its own dependency file.

**Why:** the judge is a single latency-sensitive call on every answer, with a forced JSON schema. Wrapping it in an orchestration framework adds latency, a second LLM abstraction (litellm) that breaks the provider-agnostic design, and a less deterministic verdict — while buying nothing, because there is no multi-step reasoning to orchestrate.

**Where a framework does belong:** the consumer side. An incident-resolution crew that calls this service through MCP or REST is exactly the intended use, and it stays outside the API's dependency tree.

---

## Server-side refusal fallbacks are on by default

**Decided:** Anthropic requests carry `fallbacks: "default"`, sent via `extra_body` so an older SDK cannot break every call, with a one-time auto-disable if the endpoint rejects it.

**Why:** Claude's safety classifiers can decline a request (HTTP 200, `stop_reason: "refusal"`), and incident data — exploit traces, log dumps, security tooling — sits close enough to those categories to trip false positives. Without a fallback, an operator mid-incident gets nothing.

**How to turn it off:** `server_side_fallback=False` when constructing `AnthropicLLM`.

---

## Abstention is a result, not an error

**Decided:** `/answer` returns HTTP 200 with `abstained: true` and a reason, including when the generator itself fails.

**Why:** callers get the retrieved sources either way and can decide what to do. A 4xx/5xx would push agents toward retry logic and their own model knowledge, which is precisely the behaviour the guardrails exist to prevent.

**Documented in the MCP tool descriptions**, because a schema cannot express "this is a result you must report, not a failure you should route around".

---

## Host ports default off the standard ones

**Decided:** Postgres publishes on `55432`, Redis on `56379`, both overridable.

**Why:** developers commonly already run Postgres and Redis locally; binding 5432 and 6379 makes `make up` fail with a port conflict on a machine that was working fine. Containers reach each other by service name, so the mapping only affects host tooling.

---

## Secrets are encrypted in Postgres, and the vault wins over the environment

**Decided:** connector credentials are stored AES-256-GCM-encrypted under `SECRETS_KEY`, referenced as `${NAME}`, and resolved vault-first, environment-second.

**Why:** the original design — `${VAR}` from the worker's environment only — meant adding a Slack source required editing `.env` and restarting the worker. That is defensible for a deployment driven by an orchestrator's secret injection, and unusable for a setup screen. Keeping *both*, with one syntax, means existing source configs kept working with no rewrite.

Vault-first rather than environment-first because the alternative is a form that appears to save and silently changes nothing whenever a variable of the same name already exists in `.env` — the worst possible failure for a credential.

**What protects it:** the secret name is authenticated (AES-GCM associated data), so a ciphertext copied into another row fails to decrypt rather than becoming a different token. A key fingerprint is stored per row, so rotating `SECRETS_KEY` produces a clear error rather than a corrupt value that surfaces as a vendor 401 days later. No endpoint returns a plaintext secret; the last four characters are all the API will ever emit.

**Revert consequence:** leaving `SECRETS_KEY` unset already disables the vault cleanly and falls back to environment-only resolution. Nothing else has to change.

---

## Connectors declare their own form schema

**Decided:** each `@register(...)` carries the connector's field list — label, type, required, default, help, advanced — served by `GET /v1/source-types`. The UI renders forms from it.

**Why:** the alternative is one hardcoded form per connector in the frontend. Adding a connector then means a backend change *and* a frontend change in a different language, and the two drift the first time a field is renamed — silently, because a form that writes `config.token` when the connector reads `config.api_token` produces an empty credential, not an error.

**Revert consequence:** the forms stop matching the connectors, in a way no type checker can see.

---

## Test connection runs before save, on the unsaved config

**Decided:** `POST /v1/sources/test` validates required fields, resolves every `${NAME}`, then runs a vendor probe.

**Why:** the loop without it is save → wait an interval → read `last_error`. An hour of feedback on a two-second typo, and during a hackathon demo that is the demo.

The probes deliberately check more than authentication. A valid Slack token whose bot was never invited to the channel, a JQL nobody can parse, an `items_path` that resolves to nothing — each produces a source that runs green and indexes zero documents, which is the hardest failure to notice.

---

## Prompts are versioned rows, validated on write

**Decided:** prompts live in `prompts` / `prompt_versions` with an immutable history; `app/rag/prompts.py` remains version 1 and the fallback when the database is unreachable. `query_logs.prompt_versions` records what produced each answer.

**Why validation is the load-bearing part:** an `answer_template` saved without `{context}` still renders. The model receives no passages and answers from its own knowledge — while citation validation and the groundedness judge both keep reporting success, because they check against a context that was never sent. Every guardrail shows green while the system does the exact thing it exists to prevent. That has to fail on write, not at request time.

The same check rejects unknown placeholders, which catches a subtler case: a prompt containing a JSON example (`{"ok": true}`) raises `KeyError` inside `str.format()` during a real incident.

**Why versions are immutable:** a trace points at the version that produced it. Editing a version in place would silently rewrite history, and an answer from last month would no longer be explainable.

**Revert consequence:** dropping the tables falls back to the code constants with no code change — `get_prompt_set` already treats a failed lookup that way.

---

## A collection prompt override applies only to single-collection queries

**Decided:** a per-collection prompt override is used when a request targets exactly one collection; otherwise the global prompt applies.

**Why:** a query spanning two collections has no principled winner. Picking the first would make the same question answer differently depending on the order of the `collections` array — a bug that reproduces only sometimes and looks like model nondeterminism.

---

## Pinned traces survive retention

**Decided:** `prune_logs` skips `query_logs.pinned`, and `POST /v1/traces/{id}/pin` sets it.

**Why:** a merged PR lives in git history forever; an unpinned trace is deleted after `TRACE_RETENTION_DAYS`. A PR body that links to its own justification would 404 a month later — exactly when someone audits the decision. The retention job exists because `query_logs` grows with every agent call, so the fix is an exemption rather than keeping everything.

**The recommendation that goes with it:** a PR body should *both* embed a snapshot of the citations and verdict *and* link to the live trace. The snapshot survives any retention policy; the link gives the full 8-passage context while the trace exists.

---

## The abstention threshold is measured, not chosen

**Decided:** `MIN_CONTEXT_SCORE` is derived from `make eval`, which reports the confidence distributions of answerable and unanswerable questions and the gap between them.

**Why:** it was 0.35, picked by reading a handful of scores by hand. The measured ceiling for out-of-corpus questions is 0.427, so three of four such questions — including one phrased as an invented incident id — passed the gate and reached the model. They were answered safely, but by the model choosing to behave rather than by the guarantee the gate is supposed to provide.

**Revert consequence:** any change to the embedding model or a substantial change to the corpus moves both distributions. A stale threshold fails silently in the expensive direction.
