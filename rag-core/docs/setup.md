# Setup

Everything needed to connect a data source, schedule it, and tune the prompts,
without editing a file or restarting a container.

The UI lives at **`/setup`** and has four tabs. Each maps to a REST surface, so
the orchestrator app can do the same things without a browser.

---

## Connectors

### Forms are generated, not written

`GET /v1/source-types` returns the field schema of every connector, and the UI
builds its forms from it:

```json
{
  "vault_enabled": true,
  "types": [{
    "name": "slack",
    "label": "Slack",
    "description": "Indexes resolved threads, not individual messages…",
    "testable": true,
    "fields": [
      {"name": "token", "label": "Bot token", "type": "secret", "required": true,
       "help": "Needs channels:history, channels:read and users:read.", "advanced": false},
      {"name": "channels", "label": "Channel IDs", "type": "list", "required": true,
       "help": "IDs, not names — a renamed channel keeps its ID."}
    ]
  }]
}
```

The schema lives next to the connector, in its `@register(...)` call. That is
the point: hardcoding one form per connector in the frontend means every new
connector is two changes in two languages, and the two drift the first time a
field is renamed.

Field types the UI knows how to render: `text`, `secret`, `number`, `boolean`,
`textarea`, `list`, `keyvalue`, `select`. Fields marked `advanced` collapse
behind a toggle, because Jira has ten configuration knobs and two of them
matter on the first day.

### Test before saving

`POST /v1/sources/test` validates an **unsaved** config against the real vendor.
Three layers, cheapest first:

1. Required fields present.
2. Every `${NAME}` reference resolves — vault or environment.
3. The connector's own probe, when it has one.

The first two need no network and catch what actually goes wrong. The third is
what turns "saved" into "works":

| Connector | Probe | What it catches |
|---|---|---|
| `slack` | `auth.test` + `conversations.info` per channel | A valid token whose bot was never `/invite`d — the failure that reads like a permissions bug |
| `jira` | `/myself` then the JQL with `maxResults=1` | Credentials that work against a JQL nobody can parse |
| `confluence` | CQL with `limit=1` | Same, plus a `/wiki` suffix left off the base URL |
| `git_repo` | `git ls-remote --heads <url> <branch>` | A wrong branch name, without cloning a large repo to find out |
| `filesystem` | Resolve, then count files matching the globs | A host path never mounted into the worker |
| `http_json` | Fetch once, resolve `items_path` and `id_field` | A mapping that points at nothing — the source runs green and indexes zero |
| `aws_logs` | `describe_log_groups` by prefix | A typo'd log group, reported with the near-misses |
| `mcp` | `initialize` + `list_tools` | A tool name the server does not expose, listed alongside the ones it does |

Without this the loop is: save, wait an interval, read `last_error`. That is an
hour of feedback on a two-second mistake.

### The schedule

`interval_seconds` on each source, minimum 60. There is no crontab: a worker
cron ticks once a minute and enqueues whatever is due, so an interval changed
through the API takes effect on the next tick with no redeploy.

`next_run_at` is derived (`last_run_at + interval_seconds`) and returned by
`GET /v1/sources` so the UI can show when a source is due rather than making
the reader compute it.

### Run history

`sources.last_status` is overwritten on every poll. A connector that fails one
poll in ten therefore looks healthy nine times out of ten — the single most
misleading signal in a scheduler.

`GET /v1/sources/{id}/runs` returns one row per attempt: trigger (`schedule` or
`manual`), status, duration, and the document counts split into
indexed / unchanged / failed. Retention matches traces (`TRACE_RETENTION_DAYS`).

---

## Secrets

### What it is

Connector credentials, encrypted with AES-256-GCM under `SECRETS_KEY` and
stored in Postgres. Referenced from a source config as `${NAME}`.

```bash
make secrets-key          # → SECRETS_KEY=<32 bytes, urlsafe-base64>
```

### Resolution order

Vault first, then the worker's environment. The vault wins so that pasting a
token in the UI overrides a stale one baked into `.env` — the alternative is a
form that appears to save and changes nothing.

Leaving `SECRETS_KEY` unset disables the vault entirely and `${NAME}` resolves
from the environment only, exactly as before. Existing source configs keep
working either way; nothing had to be rewritten.

### What the API will not do

**There is no endpoint that returns a stored secret.** `GET /v1/secrets`
returns names, descriptions, the last four characters, and which sources
reference each one. Four characters is enough to tell two tokens apart and not
enough to use one.

Three further properties, each protecting against a specific mistake:

- **The name is authenticated, not encrypted** (AES-GCM associated data). A
  ciphertext copied into another row fails to decrypt instead of silently
  becoming a different token.
- **A key fingerprint is stored** alongside each row. Rotating `SECRETS_KEY`
  produces `secret 'X' was encrypted with a different SECRETS_KEY`, not a
  corrupt value that surfaces as a vendor 401 days later.
- **`GET /v1/sources` redacts.** Configs *should* only hold `${NAME}`
  references, but nothing stops an API caller from POSTing a literal token, and
  returning it would leak it to every reader of the endpoint.

Writing secrets needs the `admin` scope. A `write`-scoped agent can register
sources; handing out vendor credentials is a separate privilege.

### Rotation

Save the same name again. Every source referencing it picks up the new value on
its next poll — no restart, because the vault is read at poll time rather than
at worker boot.

---

## Prompts

Prompts live in the database with immutable versions. `app/rag/prompts.py`
remains version 1 of each and the fallback when the database is unreachable —
generation must not fail because the prompt table is down.

| Key | What it drives |
|---|---|
| `answer_system` | The generator's rules |
| `answer_template` | How passages and the question are presented — needs `{context}` and `{question}` |
| `groundedness_system` | How the judge decides support. Changing the definition of `score` changes what `MIN_GROUNDEDNESS_SCORE` means |
| `groundedness_template` | Needs `{context}` and `{answer}` |
| `abstain_message` | Returned verbatim when retrieval is below threshold — no model call happens, so this is the literal response |

Scope is global, with an optional per-collection override. The override applies
only when a request targets **exactly one** collection: a query spanning two has
no principled winner, and picking one would make the same question answer
differently depending on argument order.

### Validation is the load-bearing part

An `answer_template` saved without `{context}` **still renders**. The model is
simply handed no passages and answers from its own knowledge — while citation
validation and the groundedness judge keep reporting success, because both
check against a context that was never sent. Every guardrail says green while
the system does the one thing it exists to prevent.

So `PUT /v1/prompts/{key}` rejects, with 422:

```
missing required placeholder(s) ['context']. Without them the model is not
given the data they carry.

unknown placeholder(s) ['invented']; this prompt accepts ['context', 'question'].
Write a literal brace as {{ or }}.
```

That second one matters more than it looks: a prompt containing a JSON example
(`Reply as {"ok": true}`) raises `KeyError` inside `str.format()` at request
time — which is to say, during an incident.

### Versions and traces

Every save creates a version; saving an unchanged body is a no-op rather than a
version that differs in nothing. `POST /v1/prompts/versions/{id}/activate` rolls
back or forward. `POST /v1/prompts/{key}/reset` restores the shipped default as
a *new* version, keeping the history.

`query_logs.prompt_versions` records which version produced each answer, and
`/answer` returns it. An answer from last month stays explainable after the
prompt has moved on — without it, editing a prompt silently invalidates every
past trace.

### Run the eval after editing

```bash
make eval
```

An editable prompt is a button for degrading the system without noticing. See
[evaluation.md](evaluation.md).

---

## MCP — two directions

These are opposite things and the names are unhelpfully similar.

**Agents consuming this service.** `app/mcp_server.py`, a thin stdio client over
the REST API, exposing `rag_search`, `rag_answer`, `rag_ingest`, `rag_feedback`,
`rag_list_collections`. Because it goes through REST, an agent cannot reach
retrieval by a path that skips the confidence gate. The Setup tab generates the
client config block with the current origin and key filled in.

**This service consuming other MCP servers.** The `mcp` connector — the worker
becomes an MCP *client*, calls a tool on a vendor's server, and indexes the
result. GitHub, Sentry and Linear all ship MCP servers; pointing at one is less
work than writing a connector. See [sources.md](sources.md#mcp).

---

## API reference

| Method | Path | Scope | Purpose |
|---|---|---|---|
| `GET` | `/v1/source-types` | read | Field schema per connector |
| `POST` | `/v1/sources/test` | write | Validate an unsaved config |
| `GET` | `/v1/sources/{id}/runs` | read | Poll history |
| `POST` | `/v1/secrets` | admin | Store a credential |
| `GET` | `/v1/secrets` | admin | Metadata only — never the value |
| `DELETE` | `/v1/secrets/{name}` | admin | Remove |
| `GET` | `/v1/prompts` | read | Active prompts + definitions |
| `GET` | `/v1/prompts/{key}/versions` | read | History |
| `PUT` | `/v1/prompts/{key}` | admin | Save and activate a new version |
| `POST` | `/v1/prompts/versions/{id}/activate` | admin | Roll back |
| `POST` | `/v1/prompts/{key}/reset` | admin | Restore the default |
| `POST` | `/v1/traces/{id}/pin` | write | Exempt from retention pruning |
| `GET` | `/v1/incidents/{id}/traces` | read | Every query made for one incident |

## `incident_id` is required

`/answer` and `/answer/stream` reject a call without one, with 422 and an
explanation. `REQUIRE_INCIDENT_ID=false` restores the old behaviour for
exploratory use.

It is rejected rather than defaulted to something generated. An auto-filled id
groups nothing, and the caller would never learn it was supposed to send one —
the failure would surface months later as an incident whose reasoning cannot be
reconstructed, which is precisely what the field exists to prevent.

The orchestrator app already holds the id. It just has to pass it.
