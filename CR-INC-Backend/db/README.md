# Database — AI Incident Response Orchestrator

PostgreSQL DDL implementing [`../ai_incident_response_database_schema.md`](../ai_incident_response_database_schema.md),
MVP scope (section 13): all 11 tables, plus the dashboard queries from section 10 as views.

Requires **PostgreSQL 13+** (built-in `gen_random_uuid()`) with **pgvector ≥ 0.5.0** (HNSW index).

Hosting it on Supabase instead of locally? [`SUPABASE.md`](SUPABASE.md) is the walkthrough.

## Quick start

```bash
# 1. Local database with pgvector already installed
docker compose -f db/docker-compose.yml up -d

# 2. Connection settings
cp db/.env.example db/.env

# 3. Create everything + the agent registry + demo data
./db/migrate.sh --seed
```

Then:

```bash
psql "$DATABASE_URL" -c "SELECT * FROM v_incident_kpis;"
psql "$DATABASE_URL" -c "SELECT * FROM v_incident_timeline LIMIT 10;"
```

No local `psql`? Use the one inside the container:

```bash
docker compose -f db/docker-compose.yml exec postgres psql -U incident -d incident_response
```

## Runner

```bash
./db/migrate.sh            # apply pending migrations
./db/migrate.sh --status   # applied / pending / modified-after-apply
./db/migrate.sh --seed     # apply, then run every db/seeds/*.sql (idempotent)
./db/migrate.sh --reset    # DESTRUCTIVE: drop everything, replay from 001 (asks to confirm)
```

No `psql` — Supabase, or Windows without libpq on PATH? `db/migrate.py` is the same contract
(filename order, once each, same `schema_migrations` table and checksums) over a Python driver,
so a schema half-applied by one runner is finished correctly by the other:

```bash
pip install "psycopg[binary]"           # or rely on the asyncpg in requirements.txt
python db/migrate.py --status
python db/migrate.py --seed 001_agents
python db/migrate.py --bundle > schema.sql   # one script for the Supabase SQL editor
```

## Demo data

Two different jobs, so two different tools:

| | `seeds/002` + `seeds/003` | `seed_demo.py` |
|---|---|---|
| Shape | hand-authored fixture, ~12 incidents | generated corpus, 480 incidents over 21 days |
| Job | one of every edge case, readable in one sitting | make the aggregates behave like a running system |
| Use it for | reasoning about a specific state | demos, charts, medians, capped panels, load |

The generator exists because the dashboard's queries are statistical: `VOLUME` takes a
median per day bucket, `PERFORMANCE_TILES` runs `percentile_cont(0.5)` over the window,
`NOW_TILES` compares every tile against the same predicate 24 hours ago, and
`RECENT_FAILURES` / `BY_SERVICE` / `DOCUMENTS_DRIVING_RESOLUTIONS` are `LIMIT 5`/`LIMIT 10`.
A twelve-incident fixture cannot fill any of that, and an under-filled capped panel reads
as a broken one.

```bash
python db/seed_demo.py                 # 480 incidents over 21 days, then verify
python db/seed_demo.py --summary       # what is loaded, and whether every panel fills
python db/seed_demo.py --purge         # remove exactly what it wrote, nothing else
python db/seed_demo.py --out demo.sql  # emit SQL instead (no connection needed)
```

It reports two things after loading, and both are the point:

* **Consistency** — eleven checks that must all be zero. They exist because filler data
  that contradicts itself is worse than none: every panel becomes a suspected bug. The
  checks cover `is_known_incident` agreeing with the best similarity score against
  `known_incident_threshold`, `resolved_at` agreeing with status, timestamps never
  running backwards or into the future, and approvals never half-written.
* **Panel fill** — whether each capped or median-taking panel has enough rows in the
  dashboard's default 7-day range. The approval queue is the binding constraint: only
  incidents younger than 72 hours can still be pending, so the queue scales with the
  arrival rate while everything else scales with the corpus. That is what sets the
  default of 480.

Rows are tagged with `0de0` in the second UUID group, which is what makes `--purge`
exact — it cannot touch the hand-authored fixtures or real data.

**It does not seed the Validation Agent**, and never writes a `VALIDATION_PASSED` event.
That agent is registered but not implemented ([`../docs/architecture.md`](../docs/architecture.md)),
which is why the funnel's last stage reads "Not yet available". Seeding runs for it would
report an unbuilt capability as shipped, so two of the consistency checks assert its
absence.

Each migration runs in one transaction together with its `schema_migrations` row, so a failed
migration applies nothing and is retried on the next run. Files are applied in filename order,
exactly once, and their checksum is recorded — editing an already-applied migration is reported
rather than silently ignored.

`DATABASE_URL` resolution order: exported env var → `db/.env` → `../.env` → the docker-compose default.

## Layout

| File | Contents |
|---|---|
| `migrations/001_extensions.sql` | `uuid-ossp`, `vector`, `pg_trgm` |
| `migrations/002_enums.sql` | Enum types (doc §12) |
| `migrations/003_functions.sql` | `set_updated_at()` trigger function |
| `migrations/004_services_incidents.sql` | `services`, `incidents` (doc §3) |
| `migrations/005_incident_events.sql` | `incident_events` (doc §4) |
| `migrations/006_agents_agent_runs.sql` | `agents`, `agent_runs` (doc §5) |
| `migrations/007_actions.sql` | `recommended_actions`, `executed_actions` (doc §6) |
| `migrations/008_knowledge.sql` | `knowledge_documents`, `knowledge_embeddings` (doc §7) |
| `migrations/009_similarity_matches.sql` | `similarity_matches` (doc §8) |
| `migrations/010_developer_feedback.sql` | `developer_feedback` (doc §9) |
| `migrations/011_dashboard_views.sql` | Dashboard views (doc §10) — optional, droppable |
| `migrations/012_api_support.sql` | The links and indexes the dashboard API needs |
| `migrations/013_supabase_rls.sql` | RLS + revokes, so Supabase's PostgREST exposes nothing |
| `seeds/001_agents.sql` | The seven agents from doc §5.1 |
| `seeds/002_demo_data.sql` | One resolved + one open incident, end to end. Local only |
| `reset.sql` | Drops every object the migrations create |
| `seed_demo.py` | Generates a volume corpus for exercising the dashboard |
| `migrate.sh` | The reference runner (needs `psql`) |
| `migrate.py` | The same runner without `psql`, for Supabase and Windows |

## Embedding dimension

`knowledge_embeddings.embedding` is `vector(1536)` — OpenAI `text-embedding-3-small`/`ada-002`.
Change it in `migrations/008_knowledge.sql` **before** loading the corpus if the model differs:
Titan Text Embeddings V2 and Cohere v3 are `1024`, `text-embedding-3-large` is `3072`.
Changing it afterwards means altering the column and re-embedding every chunk.

The HNSW index uses `vector_cosine_ops`, so retrieval must order by the matching operator:

```sql
SELECT d.title, d.summary, 1 - (e.embedding <=> $1) AS similarity
FROM knowledge_embeddings e
JOIN knowledge_documents d ON d.id = e.knowledge_document_id
ORDER BY e.embedding <=> $1
LIMIT 5;
```

## Decisions taken on top of the schema doc

These are the deliberate differences from the markdown, all additive:

1. **`TIMESTAMPTZ`, not `TIMESTAMP`.** Incident timelines are compared across regions and DST
   boundaries; a naive timestamp makes "time to resolve" wrong by hours.
2. **Enums only where the set is closed.** `status`, `priority`, `risk_level`, `match_type`,
   `feedback_type`, `document_type` and the two execution statuses are enums (doc §12).
   `category`, `source`, `environment`, `event_type` and `action_type` stay `VARCHAR` — those grow
   whenever an agent or MCP tool is added, and an append-only event log must never reject a write.
3. **`confidence_score` / `similarity_score` are `NUMERIC(n,m)` with a `0..1` CHECK.** Bare
   `DECIMAL` is unbounded, and a model returning `95` instead of `0.95` would corrupt every metric.
4. **Idempotent intake.** Partial unique indexes on `incidents(source, external_id)` and
   `knowledge_documents(source, source_id)` — a redelivered alert or re-ingested runbook updates
   instead of duplicating. Insert with `ON CONFLICT DO NOTHING` / `DO UPDATE`.
5. **Explicit FK indexes.** PostgreSQL does not index foreign keys automatically; every
   `incident_id`, `agent_run_id`, `knowledge_document_id` and `recommended_action_id` is indexed,
   otherwise every timeline render is a sequential scan.
6. **Delete semantics.** Incident children (`incident_events`, `agent_runs`,
   `recommended_actions` → `executed_actions`, `similarity_matches`, `developer_feedback`) are
   `ON DELETE CASCADE`. `agent_runs.agent_id` is `RESTRICT` so run history stays attributable —
   deactivate an agent with `is_active = FALSE`. `knowledge_documents.incident_id` and
   `incidents.service_id` are `SET NULL`, because knowledge outlives the incident that produced it.
7. **`updated_at` maintained by trigger**, not by application code.
8. **Added columns the doc omitted:** `recommended_actions.created_at/updated_at`,
   `executed_actions.created_at/executed_by`, and the optional `agent_runs` metrics
   (`tokens_input`, `tokens_output`, `latency_ms`, `model`, `prompt_version`) — cheap now,
   painful to backfill after the demo.
9. **`UNIQUE (knowledge_document_id, chunk_index)`** so re-chunking a document cannot leave two
   chunk 0s, and re-embedding can upsert.
10. **Sanity CHECKs:** `finished_at >= started_at`, `resolved_at >= created_at`,
    `chunk_index >= 0`, and `approved_by`/`approved_at` set together (an approval is a who *and* a
    when — an audit trail with one half missing is not an audit trail).

`similarity_matches` is intentionally **not** unique per `(incident_id, knowledge_document_id)`:
re-running retrieval after the corpus grows should record a new scored match. Read the latest with
`DISTINCT ON (knowledge_document_id) ... ORDER BY knowledge_document_id, created_at DESC`.

## Adding a migration

Never edit an applied file — add the next number:

```bash
$EDITOR db/migrations/012_add_sla_tracking.sql
./db/migrate.sh
```

Keep statements idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`) so a partially-applied
environment can catch up. To hand a single-file schema to someone:

```bash
pg_dump --schema-only --no-owner "$DATABASE_URL" > schema.sql
```
