# Documentation

Architecture, flows and design decisions for the RAG service. All diagrams are Mermaid embedded in Markdown — GitHub and VSCode render them with no toolchain.

## Read this first (about 10 minutes)

1. [C4 L1 — System context](architecture/01-context.md) — who uses it, what it depends on, where the trust boundaries are.
2. [C4 L2 — Containers](architecture/02-containers.md) — the deployable units and the degraded modes.
3. [Asking a question](flows/query-answer.md) — the main flow and every point where the system decides *not* to answer.
4. [Decisions](decisions.md) — the choices you would otherwise undo by accident.

That is enough to reason about the system. Everything below is depth.

## Architecture

| Document | Contents |
|---|---|
| [C4 L1 — Context](architecture/01-context.md) | Actors, external systems, trust boundaries |
| [C4 L2 — Containers](architecture/02-containers.md) | API, worker, MCP server, Postgres, Redis, UI · degraded modes |
| [C4 L3 — Components](architecture/03-components.md) | Modules inside the API and the worker · the connector contract |
| [C4 L4 — Code](architecture/04-code.md) | Provider adapter interfaces · retrieval types |
| [Deployment](architecture/deployment.md) | Local compose topology, startup gating, volumes, what this is not |

## Flows

| Document | Contents |
|---|---|
| [Asking a question](flows/query-answer.md) | Retrieval → gate → generate → cite → judge → log · SSE and async variants |
| [Ingesting a document](flows/ingestion.md) | Idempotency, chunker selection, metadata inheritance, failures |
| [Polling a source](flows/source-polling.md) | Scheduler, cursors per connector, secrets, deletions |
| [An agent using the service](flows/mcp-agent.md) | MCP tools, why they are a thin client, the CrewAI crew |

## Reference

| Document | Contents |
|---|---|
| [Data model](data-model.md) | ER diagram, table-by-table, index rationale |
| [Retrieval](retrieval.md) | Hybrid mechanics, RRF, every tuning knob |
| [Anti-hallucination](anti-hallucination.md) | The four layers and what each one is blind to |
| [Sources](sources.md) | Config reference for all eight connectors |
| [Setup](setup.md) | Connector catalog, the secret vault, versioned prompts, MCP in both directions |
| [Evaluation](evaluation.md) | The golden set, what it measures, and how the abstention threshold is derived |
| [Frontend](frontend.md) | UI spec, screens, SSE contract |
| [Decisions](decisions.md) | ADRs with rationale and revert consequences |

## If you are here to…

| Goal | Start at |
|---|---|
| Understand the whole system | [Context](architecture/01-context.md) → [Containers](architecture/02-containers.md) → [Query flow](flows/query-answer.md) |
| Add a data source | [Setup](setup.md#connectors) → [Sources reference](sources.md) |
| Store a vendor token | [Setup](setup.md#secrets) |
| Change a prompt | [Setup](setup.md#prompts) → then [Evaluation](evaluation.md) |
| Tune the abstention threshold | [Evaluation](evaluation.md#calibration--the-part-that-replaces-a-guess-with-a-number) |
| Swap an embedding or LLM vendor | [C4 L4](architecture/04-code.md) → the main [README](../README.md#swapping-providers) |
| Improve answer quality | [Retrieval](retrieval.md) → [Anti-hallucination](anti-hallucination.md) |
| Debug a bad answer | [Query flow](flows/query-answer.md) → `GET /v1/traces/{query_log_id}` |
| Keep a trace alive for a PR | [Setup](setup.md#api-reference) → `POST /v1/traces/{id}/pin` |
| Connect an agent | [MCP flow](flows/mcp-agent.md) → [agents/](../agents/README.md) |
| Change the schema | [Data model](data-model.md) |

## Keeping diagrams honest

```bash
./scripts/validate_diagrams.sh
```

Extracts every Mermaid block and runs it through Mermaid's own parser in a throwaway container, so a broken diagram cannot be committed. It parses syntax, not truth — when the code changes, the diagram is still yours to update.
