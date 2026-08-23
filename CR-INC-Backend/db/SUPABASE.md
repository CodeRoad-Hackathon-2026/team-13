# Standing the database up on Supabase

The schema in [`migrations/`](migrations/) is ordinary PostgreSQL and runs on Supabase unchanged.
This is the walkthrough, plus the four things about Supabase that will bite if nobody says them
out loud. For the schema itself — what the tables are and why — read [`README.md`](README.md).

## What actually goes in Supabase

The stack has **two** databases, and only one of them belongs here:

| Database | Owner | Contents |
|---|---|---|
| `incident_response` | this repo | Incidents, agent runs, actions, feedback — the 12 migrations |
| `rag` | RAG Core (`../hackaton`) | The document corpus and its vectors |

[`../deploy/postgres-init.sql`](../deploy/postgres-init.sql) creates both on the local Postgres.
Supabase gives you one database per project (`postgres`), so the two want **two projects** —
or keep RAG Core local and move only the orchestrator's schema up. Nothing in this repo reads
the RAG's tables; it talks to RAG Core over HTTP, so the split is already clean.

This is also why `knowledge_embeddings` stays empty. It exists because the schema document
specifies it, but retrieval runs through RAG Core — the orchestrator never writes a vector.
pgvector is still required: migration `008` declares the column.

---

## Step by step

### 1. Create the project

[supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Pick a region close to
wherever the orchestrator runs; every query in the dashboard pays that round trip twice.

**Save the database password on the spot.** It is shown once, it is not the `anon` key or the
`service_role` key, and the only recovery is a reset.

### 2. Enable pgvector

**Database → Extensions →** search `vector` → enable. `pg_trgm` too, while you are there.

Migration `001` would install both itself, but enabling them from the dashboard puts them in the
`extensions` schema the way Supabase expects, and it fails visibly here rather than three
migrations in.

### 3. Get the connection string

**Project Settings → Database → Connection string → URI**, and pick the **Session pooler**:

```
postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Which of the three you take matters:

| | Port | Use it? |
|---|---|---|
| **Session pooler** | 5432 | **Yes.** IPv4, one backend per connection — what a long-lived `asyncpg` pool wants |
| Transaction pooler | 6543 | Works. `app/db.py` disables asyncpg's statement cache when it sees a pooler host, which is what a transaction pooler requires |
| Direct connection | 5432 | IPv6-only unless the project has the IPv4 add-on, so it fails on most home and office networks |

Two things that look like network faults but are not: the username is `postgres.<project-ref>`,
not `postgres`; and a password containing `@ : / ? #` or `%` must be percent-encoded or the URL
parses into the wrong host.

### 4. Point the migrator at it

```bash
cp db/.env.example db/.env
$EDITOR db/.env          # DATABASE_URL=<the URI from step 3>
```

`db/.env` is gitignored. Keep it that way — that string is full database access.

### 5. Apply the migrations

There is no `psql` on a machine that has no local Postgres, so use the Python runner. Same
contract as `migrate.sh`, same `schema_migrations` table, same checksums:

```bash
pip install "psycopg[binary]"          # or rely on the asyncpg already in requirements.txt
python db/migrate.py --status          # look before you write: all 13 should say "pending"
python db/migrate.py --seed 001_agents # migrate, then register the eight agents
```

`--seed 001_agents` rather than `--seed`: the other two seed files are demo incidents, which
belong on a laptop and not in a shared project. Add them deliberately with `--seed`.

Expect thirteen `-->` lines and then the table list. Each migration commits with its own
bookkeeping row, so a failure applies nothing and re-running retries exactly that file.

**No Python either?** `python db/migrate.py --bundle > schema.sql` writes every migration plus the
agent registry as one script — paste it into the Supabase **SQL Editor**. It records its own
`schema_migrations` rows, so the migrator agrees with it afterwards instead of replaying
everything.

### 6. Verify

In the SQL Editor:

```sql
select count(*) from agents;                 -- 8
select * from v_incident_kpis;               -- one row, all zeros
select filename from schema_migrations order by filename;   -- 001 .. 013
select extname from pg_extension where extname in ('vector', 'pg_trgm');
```

And check the lockdown landed — this is the point of migration `013`:

```sql
select relname, relrowsecurity from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by relname;
```

Every row must read `true`. The **Advisors → Security** page should list no "RLS disabled in
public" findings.

### 7. Point the orchestrator at it

```bash
cp .env.example .env
$EDITOR .env             # DATABASE_URL=<same URI>, plus ANTHROPIC_API_KEY / VOYAGE_API_KEY
```

Then either run the API directly:

```bash
uvicorn app.main:app --port 8001
curl localhost:8001/api/dashboard/kpis
```

…or with the compose stack, remembering that `docker-compose.yml` **hardcodes** `DATABASE_URL` on
the `orchestrator` and `migrate` services. Those two `environment:` entries override `.env` and
must be removed or changed to `${DATABASE_URL}`, or the containers will keep talking to the local
Postgres while you wonder why the Supabase tables stay empty. The `postgres` and `migrate`
services can be dropped entirely once the schema lives upstream.

---

## Why migration 013 exists

Supabase puts PostgREST in front of the `public` schema and grants `anon` and `authenticated`
privileges on new objects there by default. Without `013`, every table these migrations create is
readable — and writable — by anyone holding the project's `anon` key, and that key ships inside
the browser bundle. A table of remediation commands and an approval audit trail are not public
data.

`013` enables RLS with no policies (so those roles see no rows) and revokes the API roles'
privileges outright, because a view is not protected by RLS — it runs with its owner's rights, so
`v_incident_kpis` would happily read `incidents` on `anon`'s behalf.

The orchestrator is unaffected: it connects as the table owner, and an owner bypasses RLS. That is
also why `FORCE ROW LEVEL SECURITY` is deliberately *not* used.

Nothing here needs PostgREST — the browser talks to nginx, nginx proxies `/api` to the
orchestrator, and the orchestrator is the only thing that opens a connection. If you later *do*
want to read a table from the browser, that is a new migration adding a policy for exactly that
table, not a revert of this one.

## Things that will go wrong

| Symptom | Cause |
|---|---|
| `Tenant or user not found` | Username is plain `postgres`. It must be `postgres.<project-ref>` on a pooler host |
| `Network is unreachable` / connection times out | Direct connection on an IPv4-only network. Use the pooler |
| `password authentication failed` | The `anon` or `service_role` key was pasted instead of the database password |
| `type "vector" does not exist` | pgvector not enabled and `001` did not run — apply migrations in order, from `001` |
| `prepared statement "_asyncpg_stmt_N_" does not exist` | asyncpg through a transaction pooler with its statement cache on. `app/db.py` detects `pooler.supabase.com`; a custom hostname needs `DATABASE_POOL_MAX_SIZE` and the cache handled by hand |
| `remaining connection slots are reserved` | The pool asks for more than the project's allotment. Lower `DATABASE_POOL_MAX_SIZE` |
| Migrator says `MODIFIED` | An already-applied file was edited. Add the next migration instead |
