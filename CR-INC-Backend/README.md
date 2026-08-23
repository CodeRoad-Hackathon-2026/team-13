# AI Incident Response Orchestrator — backend

The layer between the incident dashboard and **RAG Core**. It owns the incident
schema, serves the dashboard's API, and runs the agents that call the RAG.

It exists because RAG Core cannot serve the dashboard directly, for two
independent reasons: its database holds documents and chunks, none of the
incident tables the dashboard reads; and it authenticates with a static
`X-API-Key` whose scope also covers `/v1/secrets`, which is not a credential a
browser may hold.

```
browser ──▶ nginx ──┬──▶ /            the dashboard (static)
                    └──▶ /api         orchestrator ──▶ RAG Core ──▶ Postgres + pgvector
```

The browser only ever talks to one origin, and the RAG key lives in the
orchestrator alone.

## Running the whole system

The compose file builds all three repositories, so it expects them side by side:

```
dev/coderoad/
  ├── CR-INC-Backend       (here)
  ├── Incident-tracker-ui  (the dashboard)
  └── rag-core             (RAG Core)
```

```bash
cp .env.example .env        # set RAG_API_KEY
docker compose up --build
open http://localhost:8900
```

`RAG_API_KEY` is one key for the stack: RAG Core registers it on first boot with
admin scope, and the orchestrator authenticates with the same value — which is
why ingestion, a `write`-scope call, needs no second credential.

RAG Core's provider credentials (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, …) are
read from `../rag-core/.env` where they already live, rather than copied into a
second repo. Without them the stack still starts, but the RAG cannot embed or
answer: retrieval finds nothing and both decision-making agents abstain.

| Service | Port | What it is |
|---|---|---|
| `frontend` | 8900 | nginx: the SPA, and `/api` proxied to the orchestrator |
| `orchestrator` | 8901 | this service |
| `rag-api` | 8902 | RAG Core |
| `postgres` | 8903 | one instance, two databases (`incident_response`, `rag`) |

One Postgres, two databases: RAG Core and the orchestrator own genuinely
different data and neither should be able to migrate over the other's tables,
but a stack meant to run on a laptop should not pay for a second server.

`migrate` is a one-shot service that applies migrations and seeds, then exits.
The API waits for it to succeed, so a first request cannot race an unmigrated
schema.

## Working on it directly

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
docker compose up -d postgres && ./db/migrate.sh --seed
.venv/bin/uvicorn app.main:app --port 8001 --reload
.venv/bin/python -m pytest
```

## Where things are

| Path | What |
|---|---|
| `db/` | the schema — 11 tables, 7 views, seeds, and a migration runner |
| `app/api/` | the dashboard's 17 endpoints, plus incident ingestion |
| `app/queries/` | the SQL, kept out of the route handlers |
| `app/agents/` | the agents — see [`app/README.md`](app/README.md) |
| `app/tools/` | what an approved action can actually do |

## The empty-corpus caveat

Retrieval can only find what has been ingested into RAG Core. On a fresh stack
the corpus is empty, so classification abstains and the funnel stops at "RAG
match found" — which is correct behaviour, not a fault: a classification with
nothing behind it would look decided while being a guess.

## Seeing the whole flow

```bash
docker compose run --rm orchestrator python -m app.demo
open http://localhost:8900
```

That seeds the corpus and sends three incidents through the real pipeline. They
are chosen to land differently: the first matches a seeded runbook and comes back
known with a remediation proposed, the third matches nothing and stays a
documentation candidate. Then, in the dashboard: approve a card and watch it
reach a terminal state, open an incident row for the agent trace and timeline.

Reproducible from nothing — `docker compose down -v && docker compose up -d`
resets the database and the command refills it.

## Seeding the corpus on its own

Seed it with what the database already holds:

```bash
docker compose run --rm orchestrator python -m app.corpus
```

That pushes every `knowledge_documents` row into RAG Core, keyed by the row's
own UUID — the id retrieval resolves every hit back through. Run it again after
adding runbooks; RAG Core upserts by `external_id`.

After that the pipeline has something to work with: classification stops
abstaining, retrieval links its hits, and the Decision Agent proposes.

The Knowledge Generation Agent keeps the corpus growing on its own, but it only
learns from resolved incidents — so the first load has to come from here.
