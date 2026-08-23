# Source connectors — configuration reference

A source is a feed the scheduler polls on `interval_seconds`, tracking a cursor
so each poll only fetches what changed.

```bash
curl -X POST localhost:8000/v1/sources -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' -d '{ ...body below... }'
```

**Secrets:** write `"${NAME}"` anywhere in `config`. At poll time it resolves
from the encrypted vault first, then the worker's environment — so a token can
be pasted in the Setup UI *or* put in `.env`, with the same syntax either way.
A missing name fails the run with a clear error rather than a vendor 401. See
[setup.md](setup.md#secrets).

**Before saving, test:** `POST /v1/sources/test` runs the config against the
real vendor and reports what is wrong, instead of leaving you to read
`last_error` an interval later. Every connector below has a probe except
`filesystem`, which gets one that resolves the path and counts matching files.

---

## `filesystem`

A mounted directory. Cursor: file mtime.

```json
{
  "collection": "runbooks", "name": "local-runbooks", "type": "filesystem",
  "config": {
    "path": "/data/runbooks",
    "include": ["**/*.md"],
    "exclude": ["**/archive/**"],
    "suffixes": [".md", ".txt"],
    "metadata": {"team": "sre"}
  },
  "interval_seconds": 300
}
```

Mount the host directory into both containers (`docker-compose.yml` already
maps `./data:/data:ro`).

---

## `git_repo`

SQL, migrations, IaC and docs under version control. Cursor: commit SHA, with
`git diff --name-status` selecting the files to re-embed; deleted files are
removed from the index.

```json
{
  "collection": "code", "name": "platform-sql", "type": "git_repo",
  "config": {
    "url": "https://github.com/acme/platform.git",
    "branch": "main",
    "token": "${GITHUB_TOKEN}",
    "include": ["**/*.sql", "docs/**/*.md"],
    "exclude": ["**/node_modules/**", "**/vendor/**"],
    "max_file_kb": 512,
    "metadata": {"team": "data"}
  },
  "interval_seconds": 900
}
```

`.sql` files route to the SQL chunker: statements are split on real boundaries
(quotes, `--` and `/* */` comments and `$$…$$` bodies are respected) and the
objects each chunk defines land in `metadata.sql_objects`, so you can filter
with `{"sql_objects": ["TABLE orders"]}`.

Clones are cached under `/tmp/rag-repos`; SSH URLs work if the worker has a key
mounted.

---

## `jira`

Resolved tickets **including their comment threads** — the fix is usually in the
comments. Cursor: `updated` watermark folded into the JQL.

```json
{
  "collection": "incidents", "name": "jira-ops", "type": "jira",
  "config": {
    "base_url": "https://acme.atlassian.net",
    "email": "bot@acme.com",
    "api_token": "${JIRA_API_TOKEN}",
    "jql": "project = OPS AND statusCategory = Done",
    "custom_fields": {"severity": "customfield_10032", "service": "customfield_10044"},
    "max_comments": 50,
    "page_size": 50,
    "max_pages": 20
  },
  "interval_seconds": 900
}
```

- **Cloud:** `email` + `api_token` (id.atlassian.com → API tokens).
- **Server/DC:** `bearer_token` instead; the connector falls back to the v2 API.
- `custom_fields` maps per-instance `customfield_NNNNN` ids to clean metadata
  keys you can filter on.
- Descriptions arrive as plain text (v2) or ADF (v3); both are handled.

---

## `slack`

Incident channels, **one document per thread**. Cursor: newest thread timestamp,
rewound 24h so late replies are re-indexed.

```json
{
  "collection": "incidents", "name": "slack-incidents", "type": "slack",
  "config": {
    "token": "${SLACK_BOT_TOKEN}",
    "channels": ["C01ABCDEF", "C02GHIJKL"],
    "lookback_days": 90,
    "min_messages": 2,
    "max_threads": 200,
    "metadata": {"team": "sre"}
  },
  "interval_seconds": 600
}
```

Bot scopes: `channels:history` (public) or `groups:history` (private),
`channels:read`, and optionally `users:read` to resolve display names — without
it the connector degrades to raw user ids rather than failing. Invite the bot to
each channel.

`min_messages: 2` drops single-message threads, which are usually noise.

---

## `confluence`

Wiki pages. Cursor: `lastmodified` watermark folded into the CQL.

```json
{
  "collection": "runbooks", "name": "confluence-ops", "type": "confluence",
  "config": {
    "base_url": "https://acme.atlassian.net/wiki",
    "email": "bot@acme.com",
    "api_token": "${CONFLUENCE_API_TOKEN}",
    "space": "OPS",
    "page_size": 50
  },
  "interval_seconds": 3600
}
```

Use `cql` instead of `space` for anything more specific, e.g.
`'type = page AND label = "runbook"'`. Storage-format HTML is reduced to text;
`<script>`/`<style>` bodies are dropped.

---

## `aws_logs`

CloudWatch Logs, **collapsed into failure patterns**. Cursor: window end
timestamp.

```json
{
  "collection": "logs", "name": "payments-errors", "type": "aws_logs",
  "config": {
    "log_group": "/aws/ecs/payments-api",
    "region": "us-east-1",
    "filter_pattern": "?ERROR ?FATAL ?Exception",
    "lookback_minutes": 60,
    "min_occurrences": 2,
    "max_patterns": 200,
    "sample_lines": 3,
    "max_events": 20000,
    "metadata": {"service": "payments-api"}
  },
  "interval_seconds": 900
}
```

Each event is normalized into a fingerprint (timestamps, UUIDs, IPs, hex ids,
paths, quoted strings and numbers → placeholders), grouped, and emitted as one
document per distinct pattern with its occurrence count and verbatim samples.
`min_occurrences: 2` drops one-off noise.

**Always set `filter_pattern`.** Without it the connector pulls every line in the
window; the pattern grouping keeps the *index* small, but the API call still
scans everything.

Credentials come from the default AWS chain (IAM task role, `AWS_*` env vars,
`~/.aws`). Override per-source with `profile`, or
`aws_access_key_id`/`aws_secret_access_key` using `${VAR}` placeholders. Needs
`logs:FilterLogEvents` on the log group.

---

## `http_json`

Anything else that can return a JSON list — internal APIs, PagerDuty,
ServiceNow, Datadog, a BI export.

```json
{
  "collection": "incidents", "name": "pagerduty", "type": "http_json",
  "config": {
    "url": "https://api.pagerduty.com/incidents",
    "headers": {"Authorization": "Token token=${PAGERDUTY_TOKEN}"},
    "params": {"statuses[]": "resolved", "limit": 100},
    "items_path": "incidents",
    "id_field": "id",
    "content_fields": ["title", "description", "resolve_reason.summary"],
    "title_field": "title",
    "uri_field": "html_url",
    "updated_field": "last_status_change_at",
    "cursor_param": "since",
    "metadata_fields": {"service": "service.summary", "urgency": "urgency"}
  },
  "interval_seconds": 900
}
```

All field selectors are dotted paths. `cursor_param` is the query parameter that
receives the stored `updated_field` watermark on the next poll.

---

## `mcp`

Calls a tool on an **external** MCP server and indexes the result. GitHub,
Sentry and Linear all ship MCP servers; pointing at one is less work than
writing a connector for each.

This is the opposite direction from `app/mcp_server.py`, which exposes *our*
tools to agents. Same protocol, opposite role.

```json
{
  "collection": "incidents",
  "name": "github-issues",
  "type": "mcp",
  "config": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"},
    "tool": "search_issues",
    "arguments": {"q": "repo:acme/api is:issue label:incident"},
    "items_path": "items",
    "id_field": "number",
    "content_fields": ["title", "body"],
    "uri_field": "html_url",
    "updated_field": "updated_at",
    "cursor_argument": "since"
  },
  "interval_seconds": 3600
}
```

**Transports.** `stdio` launches the server as a subprocess of the worker;
`sse` connects to one already running (`url` + `headers`).

**Discovery.** Leave `tool` blank and run `POST /v1/sources/test` — it lists
what the server exposes. MCP tool names are rarely guessable, and this is the
mistake the probe exists to catch.

**Two results shapes, both handled.** JSON is mapped like `http_json`, one
record per document. Anything else becomes a single document — a server
answering "summarise open incidents" is useful and has no records to iterate.
Omitting `id_field` forces the single-document mode.

**Three things that bite:**

- With `stdio`, the command runs **inside the worker container**. `npx` is not
  there by default; add it to the worker image or use `sse`. The probe checks
  `PATH` and says so rather than returning a bare `FileNotFoundError`.
- The subprocess environment is `HOME` and `PATH` plus whatever `env` names —
  the worker's own environment is *not* inherited, so vendor keys held by the
  worker are not visible to a third-party MCP server.
- **Incremental only if the tool supports it.** With no `since`-style argument
  to pass through `cursor_argument`, every poll refetches everything. Content
  hashing keeps that from re-embedding, but it still costs the vendor call —
  set a longer interval.

---

## Operating

```bash
curl -X POST localhost:8000/v1/sources/$SOURCE_ID/sync -H "X-API-Key: $KEY"  # poll now
curl localhost:8000/v1/sources -H "X-API-Key: $KEY"                          # last_status / last_error
curl localhost:8000/v1/sources/$SOURCE_ID/runs -H "X-API-Key: $KEY"          # per-attempt history
```

The scheduler ticks every minute and dispatches sources whose
`interval_seconds` have elapsed. Failures are recorded on the source
(`last_status`, `last_error`), as a row in `ingestion_jobs`, and as a row in
`source_runs` — a broken connector never blocks the others.

Prefer `/runs` over `last_status` when diagnosing. `last_status` is overwritten
every poll, so a connector failing one time in ten looks healthy nine times out
of ten.

Re-ingesting unchanged content is a no-op (idempotent on
`collection + external_id + content_hash`), so a tight interval costs nothing
when nothing changed.
