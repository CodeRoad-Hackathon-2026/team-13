# Incident-response crew (CrewAI)

A three-agent crew that resolves incidents against the RAG service. It is a
**consumer**: every call goes through the public API, so the confidence gate,
citation validation and groundedness judge apply exactly as they do for any
other caller.

```
Triage ──▶ Investigator ──▶ Remediation
  │             │                │
  └──── rag_search / rag_answer ─┘
```

## Install

```bash
pip install -r agents/requirements.txt
```

Separate from the service's `requirements.txt` — CrewAI's dependency tree
(litellm, chromadb, …) has no business in the API or worker image.

## Run

```bash
export RAG_API_URL=http://localhost:8000/v1
export RAG_API_KEY=rag_sk_...
export ANTHROPIC_API_KEY=sk-ant-...       # CrewAI's own model, via litellm
export CREW_MODEL=anthropic/claude-opus-5 # optional

python -m agents.incident_crew --incident "checkout is timing out after the deploy"
```

### Dry run — no LLM, no CrewAI

```bash
python -m agents.incident_crew --incident "checkout timing out" --dry-run
```

Calls the API directly and prints what comes back, ending with the PR
justification block. It routes through `agents/client.py` rather than the tool
classes, because those import CrewAI at module load — running the dry run
through them would make it require the very dependency it exists to avoid.
Only CrewAI's agent loop is left untested.

## The PR justification block

The handoff to whatever opens the pull request:

```bash
python -m agents.incident_crew --justify INC-2481 \
  --pr-url https://github.com/acme/api/pull/4711
```

It reads `GET /v1/incidents/{id}/traces`, renders the evidence as markdown, and
**pins every trace** so the links survive.

What it emits is deliberately not the crew's own summary. The honest answer to
"why did we make this change" is the passages the service actually retrieved,
the citations that survived validation, and the judge's verdict — including a
**Not covered by the knowledge base** section listing what the service refused
to answer. Those gaps are the most useful part of the block for a reviewer, and
an agent narrating its own reasoning is exactly where they would disappear.

A crew run prints this automatically at the end.

**Why the pin matters.** A merged PR lives in git history forever; an unpinned
trace is deleted after `TRACE_RETENTION_DAYS`. Without it the "Full trace" link
404s a month later — precisely when someone audits the decision. The markdown
snapshot and the live link are not redundant: the snapshot is what a reader
sees in a year, the link gives the complete eight-passage context while the
trace exists.

## Tools

| Tool | Purpose |
|---|---|
| `rag_list_collections` | Discover how the corpus is organized |
| `rag_search` | Raw passages with scores — no LLM tokens |
| `rag_answer` | Grounded answer with citations and a verdict |
| `rag_ingest` | Write back what the investigation learned |
| `rag_feedback` | Rate a passage; feeds ranking |
| `rag_pin_trace` | Keep a trace past the retention window — call it for any answer you act on |
| `rag_incident_traces` | Replay what was already asked about this incident, including the gaps |

The tool descriptions carry the behavioural contract, not just the schema. The
one that matters: **`abstained: true` means "not in the knowledge base", not
"the call failed"** — an agent that treats it as an error and falls back to its
own weights has defeated the guardrails.

`incident_id` is **required** on `rag_answer`. The service rejects a call
without one, because it is what makes the whole investigation replayable
afterwards. The crew generates one per run and prints it; pass `--incident-id`
to join an investigation another agent started.

The triage agent calls `rag_incident_traces` first. In a multi-agent setup that
is what stops two agents from asking the same question, and it surfaces which
questions have already come back abstained — repeating one of those wastes a
turn and produces no new information.

## Two model configurations, on purpose

The crew's model (`CREW_MODEL`, via litellm) is independent of the service's
providers (`LLM_PROVIDER` / `EMBEDDING_PROVIDER`). That is the price of using a
framework that owns its own LLM layer, and it is affordable precisely because
the crew sits *outside* the API. It is also why the same framework is not used
for the groundedness judge — see [docs/decisions.md](../docs/decisions.md#no-agent-framework-inside-the-core).

## MCP instead of REST

`app/mcp_server.py` exposes the identical surface over MCP. REST is the default
here because plain HTTP is stable across CrewAI releases and unit-testable
without spawning a subprocess; switching to `MCPServerAdapter` is a wiring
change. See [docs/flows/mcp-agent.md](../docs/flows/mcp-agent.md).
