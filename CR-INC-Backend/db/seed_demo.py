#!/usr/bin/env python3
"""Generates a realistic incident corpus so the platform can actually be exercised.

Why this exists alongside db/seeds/
-----------------------------------
`seeds/002_demo_data.sql` proves one lifecycle end to end and `003_dashboard_demo.sql`
is a careful fixture: every panel gets one of every edge case — a HIGH-risk approval,
a ROLLED_BACK execution, a rejected action, a failed agent run. Both are hand-authored
and deliberately small, and they should stay that way, because a fixture you can read
in one sitting is worth more than a big one you cannot.

What they cannot do is make the product *look like it is running*. Read app/queries:

  * VOLUME buckets by day and takes a median per bucket. Ten incidents over eight
    days is a chart of mostly-1s with almost no medians.
  * PERFORMANCE_TILES wants percentile_cont(0.5) over resolutions in the window. A
    median of four values is not a median.
  * NOW_TILES compares every tile against the same predicate 24 hours ago, so the
    deltas need real population on both sides of that line.
  * RECENT_FAILURES is LIMIT 5, BY_SERVICE is LIMIT 5, DOCUMENTS_DRIVING_RESOLUTIONS
    is LIMIT 10. Under-filled, a capped panel reads as a broken panel.
  * v_agent_performance groups by agent. Three of the eight agents have no runs at
    all in the fixtures, so they render as empty rows.

So this generates volume with a shape: a causal timeline per incident, timestamps that
only move forward, and — the part that matters — aggregates that agree with each other.

The invariants, which are the whole point
-----------------------------------------
Filler data that contradicts itself is worse than no data, because every panel becomes
a suspected bug. These are enforced by construction:

  * `is_known_incident` is true if and only if the incident's best similarity match is
    at or above the threshold in app/config.py. The incident list shows both the flag
    and `best_match_score`; if they disagree the UI looks wrong.
  * The funnel's stages are strict subsets by construction (received > classified >
    matched > recommended > approved > executed_ok), so no stage can exceed the one
    above it and no drop can come out negative.
  * `resolved_at` exists only on RESOLVED/CLOSED, and never precedes `created_at`.
  * `approved_by` and `approved_at` are set together or not at all — the CHECK enforces
    it, but so does the audit trail being worth reading.
  * Every execution's `finished_at` follows its `started_at`, and every event, run,
    action and execution timestamp sits inside its incident's lifetime.
  * Every *implemented* agent gets runs, with per-agent latency and token profiles,
    so agent health is a distribution rather than a single point. The Validation
    Agent deliberately gets none, and no VALIDATION_PASSED event is ever written:
    docs/architecture.md records it as registered but not implemented, which is why
    the funnel's last stage reads "Not yet available" rather than a fabricated zero.
    Seeding it would report an unbuilt capability as shipped.
  * Only the event vocabulary app/agents/events.py actually emits, plus the approval
    and lifecycle types the existing fixtures use. An event type the dashboard has no
    icon for renders as an unlabelled row, which reads as a UI bug.

Usage
-----
    python db/seed_demo.py --summary            # what is in the database now
    python db/seed_demo.py                      # generate the default corpus
    python db/seed_demo.py --incidents 400 --days 45
    python db/seed_demo.py --out demo.sql       # emit SQL instead of executing it
    python db/seed_demo.py --purge              # remove only what this script wrote

Reproducible: same --seed, --incidents, --days gives the same corpus, apart from the
anchor timestamp. Re-running without --purge adds a second, independent corpus.

Connection handling, drivers and password redaction are reused from db/migrate.py.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import random
import sys
from datetime import datetime, timedelta

DB_DIR = pathlib.Path(__file__).resolve().parent

# --- rows this script owns --------------------------------------------------
#
# Every id carries `0de0` in its second group, following the convention the existing
# seeds use to keep their groups apart. It makes --purge exact: it can only ever match
# rows this script wrote, never the hand-authored fixtures and never real data. A
# random UUID colliding with a full 12-hex-digit prefix is a 2^-48 event.
MARK = "0de0"
PREFIX = {
    "services": "11111111",
    "incidents": "22222222",
    "incident_events": "33333333",
    "agent_runs": "44444444",
    "recommended_actions": "55555555",
    "executed_actions": "66666666",
    "knowledge_documents": "77777777",
    "similarity_matches": "99999999",
    "developer_feedback": "aaaaaaaa",
    "knowledge_embeddings": "bbbbbbbb",
}
# Children before parents: incident_events, agent_runs, recommended_actions,
# similarity_matches and developer_feedback all cascade from incidents, and
# executed_actions cascades from recommended_actions — but deleting explicitly by
# marker means --purge stays correct even if someone relaxes a cascade later.
PURGE_ORDER = [
    "knowledge_embeddings",
    "developer_feedback",
    "executed_actions",
    "recommended_actions",
    "similarity_matches",
    "incident_events",
    "agent_runs",
    "knowledge_documents",
    "incidents",
    "services",
]


def load_migrate():
    """Reuse db/migrate.py's DSN resolution, driver fallback and redaction."""
    spec = importlib.util.spec_from_file_location("_migrate", DB_DIR / "migrate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --- SQL literals ----------------------------------------------------------


class Raw:
    """A pre-built SQL fragment, emitted verbatim."""

    __slots__ = ("sql",)

    def __init__(self, sql: str) -> None:
        self.sql = sql


def lit(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, Raw):
        return value.sql
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, datetime):
        return "'{}'::timestamptz".format(value.isoformat())
    if isinstance(value, (dict, list)):
        return "'{}'::jsonb".format(json.dumps(value).replace("'", "''"))
    return "'{}'".format(str(value).replace("'", "''"))


def insert_statements(table: str, columns: list[str], rows: list[tuple], chunk: int = 200):
    """Multi-row INSERTs, chunked so one statement never gets absurdly large.

    ON CONFLICT DO NOTHING keeps a re-run with the same --seed idempotent instead of
    erroring halfway through and leaving a half-written corpus behind.
    """
    for start in range(0, len(rows), chunk):
        block = rows[start:start + chunk]
        values = ",\n    ".join(
            "(" + ", ".join(lit(v) for v in row) + ")" for row in block
        )
        yield "INSERT INTO {} ({})\nVALUES\n    {}\nON CONFLICT DO NOTHING;".format(
            table, ", ".join(columns), values
        )


# --- domain vocabulary -----------------------------------------------------
#
# Realism lives here. Generated titles like "Incident 47" make a demo look like a
# demo; a title, a description, a matching remediation and a resolution that all
# describe the same failure make it look like a system that ran.

SERVICES = [
    ("payments-api", "Payment authorization and capture.", "payments-team"),
    ("checkout-web", "Storefront checkout flow.", "checkout-team"),
    ("auth-gateway", "Token issuance and session validation.", "identity-team"),
    ("inventory-service", "Vehicle inventory read and write paths.", "inventory-team"),
    ("search-index", "Vehicle search indexing pipeline.", "search-team"),
    ("notify-worker", "Outbound email and push notification queue.", "platform-team"),
    ("pricing-engine", "Real-time pricing and incentive calculation.", "pricing-team"),
    ("media-pipeline", "Vehicle photo ingest, resize and CDN publish.", "media-team"),
]

ENGINEERS = ["a.reyes", "m.tan", "j.okafor", "l.ibarra", "s.novak", "d.haddad"]

# (category, title, description, action_type, action description, parameters,
#  resolution summary)
SCENARIOS = [
    ("Database",
     "{svc} connection pool exhausted under peak load",
     "Pool wait time above 500ms and a rising 5xx rate on write endpoints.",
     "LAMBDA", "Recycle idle connections and raise the pool ceiling to 50.",
     {"function_name": "recycle-idle-connections", "pool_size": 50},
     "Recycled idle connections and raised the pool ceiling. Latency back to baseline."),
    ("Database",
     "Deadlock between {svc} batch job and the write path",
     "Nightly reconciliation deadlocking against live writes.",
     "SQL", "Add a bounded statement timeout to the reconciliation job.",
     {"statement": "ALTER ROLE batch_job SET statement_timeout = '30s'"},
     "Bounded the batch job's statement timeout. No further deadlocks observed."),
    ("Database",
     "Replication lag on {svc} read replica beyond objective",
     "Replica lag at 90s against a 15s objective; stale reads reported.",
     "API", "Fail reads back to the primary until the replica catches up.",
     {"endpoint": "https://internal/db/failover-reads", "target": "primary"},
     "Routed reads to the primary and let the replica drain. Lag back under 5s."),

    ("API",
     "{svc} 5xx rate above 8% in eu-west",
     "Error budget burn alert. A share of requests failing for eu-west traffic.",
     "KUBERNETES", "Roll the eu-west deployment back one revision.",
     {"deployment": "{svc}", "namespace": "eu-west", "action": "rollback"},
     "Rolled back one revision. Error rate returned to baseline within four minutes."),
    ("API",
     "Elevated p99 latency on {svc} read path",
     "p99 at 2.4s against a 400ms objective; p50 unaffected.",
     "KUBERNETES", "Scale the read path from 4 to 8 replicas.",
     {"deployment": "{svc}", "replicas": 8},
     "Scaled to 8 replicas. p99 recovered to 380ms."),
    ("API",
     "{svc} totals off by one cent on split tender",
     "Rounding drift when a payment is split across two tenders.",
     "GITHUB_PR", "Fix the rounding order so tenders round after summing.",
     {"repo": "example/{svc}", "base": "main"},
     "Corrected the rounding order in the tender split. Reconciliation clean."),

    ("Deployment",
     "Stale pricing served after {svc} release",
     "CDN still serving pre-deploy pricing for tag `pricing`.",
     "API", "Purge the CDN cache for tag `pricing` across all edge regions.",
     {"endpoint": "https://cdn.example.com/purge", "tag": "pricing", "regions": "all"},
     "Purged by tag across all edges. Verified one edge before the rest."),
    ("Deployment",
     "Failed canary on {svc} blocking the rollout",
     "Canary health checks failing at 12% traffic; rollout halted.",
     "KUBERNETES", "Abort the canary and restore the stable revision.",
     {"deployment": "{svc}", "action": "abort-canary"},
     "Aborted the canary and restored stable. Root cause was a missing config key."),
    ("Deployment",
     "Migration left {svc} schema half-applied",
     "A migration timed out mid-transaction; the follow-up index is missing.",
     "SQL", "Create the missing index concurrently and record the migration.",
     {"statement": "CREATE INDEX CONCURRENTLY idx_orders_created_at ON orders(created_at)"},
     "Created the index concurrently and reconciled the migration ledger."),

    ("Infrastructure",
     "{svc} queue depth climbing steadily",
     "Consumer lag growing since 09:00 UTC with no matching traffic rise.",
     "KUBERNETES", "Scale the consumer group from 3 to 6 replicas to drain the backlog.",
     {"deployment": "{svc}", "replicas": 6},
     "Scaled to 6 replicas. Consumer lag fell from 41k to under 200."),
    ("Infrastructure",
     "Disk pressure on the {svc} node pool",
     "Two nodes above 88% disk; eviction threshold approaching.",
     "SCRIPT", "Prune unused images and rotate the oldest log segments.",
     {"script": "node-disk-reclaim.sh", "threshold": "80%"},
     "Reclaimed 140GB across the pool. Utilisation back to 61%."),
    ("Infrastructure",
     "{svc} indexing lag behind primary",
     "Indexing pipeline lag beyond the 60s objective.",
     "API", "Trigger a partial reindex for the lagging shards.",
     {"endpoint": "https://search.internal/reindex", "shards": "lagging"},
     "Partial reindex cleared the backlog. Lag steady under 20s."),

    ("Security",
     "Intermittent 401s on {svc} token refresh",
     "Expired refresh-token rows blocking the unique index; a share of refreshes 401.",
     "SQL", "Delete expired refresh-token rows in bounded batches.",
     {"statement": "DELETE FROM refresh_tokens WHERE expires_at < now() - INTERVAL '30 days' LIMIT 5000"},
     "Cleared expired rows in 5k batches. Refresh success rate back to 99.98%."),
    ("Security",
     "{svc} certificate within 7 days of expiry",
     "Leaf certificate approaching expiry; no automated rotation in place.",
     "API", "Rotate the leaf certificate and reload the gateway.",
     {"endpoint": "https://gateway.internal/rotate", "reload": True},
     "Rotated the leaf certificate and reloaded with zero dropped connections."),
    ("Security",
     "Unusual rate of failed logins against {svc}",
     "Failed-login rate 22x baseline from a narrow address range.",
     "API", "Apply a rate limit to the offending address range.",
     {"endpoint": "https://waf.internal/rules", "action": "rate-limit"},
     "Rate-limited the range. Failed-login rate returned to baseline."),

    ("Networking",
     "Packet loss between {svc} and its data store",
     "0.8% loss on the private link; retries inflating latency.",
     "API", "Shift traffic to the secondary private link.",
     {"endpoint": "https://net.internal/failover", "link": "secondary"},
     "Failed over to the secondary link. Loss down to 0.01%."),
    ("Networking",
     "DNS resolution failures for {svc} internal hostname",
     "Intermittent NXDOMAIN for the internal service record.",
     "SCRIPT", "Flush the resolver cache on affected nodes.",
     {"script": "resolver-flush.sh", "scope": "affected-nodes"},
     "Flushed the resolver cache. Resolution stable since."),

    ("Configuration",
     "{svc} feature flag left enabled in production",
     "A staging-only flag reached production and changed checkout behaviour.",
     "API", "Disable the flag in production and pin its default.",
     {"endpoint": "https://flags.internal/set", "flag": "checkout_v3", "value": False},
     "Disabled the flag and pinned its default to off outside staging."),
    ("Configuration",
     "Connection ceiling on {svc} sized for pre-migration traffic",
     "max_connections unchanged since the migration while traffic tripled.",
     "GITHUB_PR", "Raise the connection ceiling and add a borrow timeout.",
     {"repo": "example/{svc}", "base": "main"},
     "Raised the ceiling and added a 30s borrow timeout. Terraform plan clean."),

    ("Performance",
     "N+1 query pattern on the {svc} detail endpoint",
     "One request issuing 340 queries; p95 above 3s on the detail view.",
     "GITHUB_PR", "Batch the association load into a single query.",
     {"repo": "example/{svc}", "base": "main"},
     "Batched the association load. Query count per request down to 4."),
    ("Performance",
     "Cache hit rate on {svc} collapsed after key change",
     "Hit rate fell from 94% to 31% following a cache-key change.",
     "SCRIPT", "Warm the cache with the previous key shape and re-enable it.",
     {"script": "cache-warm.sh", "keyspace": "v2"},
     "Warmed the cache and restored the prior key shape. Hit rate back to 92%."),
]

RUNBOOKS = [
    ("Runbook — Restarting a saturated connection pool",
     "Drain and restart a saturated pool safely under load.",
     "Confirm saturation via pg_stat_activity. Raise max_connections in two steps. Drain. Restart."),
    ("Runbook — Purge edge cache by tag",
     "Purge a CDN tag across all edge regions without a full flush.",
     "Use the purge-by-tag API. Never full-flush during peak: origin cannot absorb it."),
    ("Runbook — Clearing expired refresh tokens",
     "Safe deletion of expired refresh-token rows blocking the unique index.",
     "Delete in batches of 5k with a bounded statement timeout. Never a single unbounded DELETE."),
    ("Runbook — Scaling a consumer group",
     "Add consumers to drain a backlog without reordering.",
     "Scale in powers of two. Watch for partition rebalance storms above 8 consumers."),
    ("Runbook — Rolling back a bad revision",
     "Roll a deployment back one revision and verify.",
     "Roll back, then verify the error rate for two full minutes before declaring recovery."),
    ("Runbook — Certificate rotation",
     "Rotate a leaf certificate and reload without dropping connections.",
     "Stage the new chain, verify it, then reload. Never restart: reload preserves connections."),
    ("Runbook — Reclaiming node disk",
     "Prune images and rotate logs under disk pressure.",
     "Prune unused images first; it is reversible. Rotate logs second. Never delete active segments."),
    ("Runbook — Private link failover",
     "Shift traffic between private links.",
     "Drain the primary before shifting, or in-flight retries double-count."),
    ("Runbook — Partial reindex",
     "Reindex lagging shards without a full rebuild.",
     "Reindex per shard. A full rebuild costs eight hours and is almost never needed."),
    ("Runbook — Feature flag rollback",
     "Disable a flag and pin its default safely.",
     "Disable, then pin the default. Disabling alone leaves the next deploy free to re-enable it."),
]

# Latency and token cost per agent, so agent health is a spread rather than a point.
# (mean latency ms, latency spread, mean input tokens, mean output tokens, model)
AGENT_PROFILE = {
    "Incident Intake Agent": (900, 350, 700, 120, "claude-haiku-4-5-20251001"),
    "Classification Agent": (2100, 700, 1400, 260, "claude-sonnet-5"),
    "RAG Retrieval Agent": (1600, 600, 950, 140, "claude-sonnet-5"),
    "Decision Agent": (3600, 1200, 1900, 300, "claude-opus-5"),
    "Execution Agent": (4200, 2600, 800, 160, "claude-sonnet-5"),
    "Validation Agent": (2400, 1500, 900, 130, "claude-sonnet-5"),
    "Knowledge Generation Agent": (5200, 1500, 1000, 640, "claude-opus-5"),
    "Change Delivery Agent": (18000, 7000, 2600, 900, "claude-opus-5"),
}

PROMPT_VERSION = {
    "Classification Agent": "classifier@4",
    "Decision Agent": "remediation-planner@3",
    "Knowledge Generation Agent": "knowledge-writer@1",
    "Change Delivery Agent": "patch-author@2",
}

# One column list, shared by both writers: the per-service runbooks and the documents
# the Knowledge Generation Agent produces from resolved incidents. They differ only in
# whether incident_id is set.
KNOWLEDGE_COLS = ["id", "title", "summary", "content", "document_type", "source",
                  "source_url", "source_id", "incident_id", "service_id", "created_at"]

DOC_TYPES_ROTATION = [
    "RUNBOOK", "POSTMORTEM", "DOCUMENTATION", "TROUBLESHOOTING_GUIDE",
    "GITHUB_ISSUE", "GITHUB_PR", "EMAIL",
]


# --- generator -------------------------------------------------------------


class Corpus:
    """Builds the whole dataset in memory, then emits it as SQL."""

    def __init__(self, anchor: datetime, args, threshold: float) -> None:
        self.now = anchor
        self.args = args
        self.threshold = threshold
        self.rng = random.Random(args.seed)
        self.tables: dict[str, tuple[list[str], list[tuple]]] = {}
        self.counter = dict.fromkeys(PREFIX, 0)
        self.stats = {
            "resolved": 0, "known": 0, "pending_approvals": 0, "auto_executed": 0,
            "failed_executions": 0, "rolled_back": 0, "running": 0, "uncategorised": 0,
        }

    # -- helpers

    def uid(self, table: str) -> str:
        self.counter[table] += 1
        return "{}-{}-4000-8000-{:012x}".format(PREFIX[table], MARK, self.counter[table])

    def add(self, table: str, columns: list[str], row: tuple) -> None:
        if table not in self.tables:
            self.tables[table] = (columns, [])
        known_columns, rows = self.tables[table]
        # Rows for one table are emitted under a single column header, so two callers
        # disagreeing about the column list silently produces a VALUES list of the
        # wrong width — a failure that surfaces as a syntax error hundreds of
        # thousands of characters into the output. Fail here instead, where the
        # offending caller is named.
        if columns != known_columns:
            raise AssertionError(
                "{}: column list differs from the first insert for this table\n"
                "  first: {}\n  this:  {}".format(table, known_columns, columns)
            )
        if len(row) != len(columns):
            raise AssertionError(
                "{}: {} values for {} columns".format(table, len(row), len(columns))
            )
        rows.append(row)

    def jitter(self, base: int, spread: int, low: int = 1) -> int:
        return max(low, int(self.rng.gauss(base, spread)))

    def q(self, value: float, places: int = 4) -> float:
        """Round into the column's scale. NUMERIC(5,4) rejects more than 4 places."""
        return round(min(1.0, max(0.0, value)), places)

    # -- services and knowledge

    def build_services(self) -> None:
        cols = ["id", "name", "description", "owner", "repository_url", "environment"]
        self.services = []
        for name, description, owner in SERVICES:
            sid = self.uid("services")
            # Names must be unique across the whole table, and the fixtures already
            # took `payments-api` and friends. A suffix keeps both loadable at once.
            unique_name = "{}-demo".format(name)
            self.services.append((sid, name, unique_name))
            self.add("services", cols, (
                sid, unique_name, description, owner,
                "https://github.com/example/{}".format(name), "Production",
            ))

    def build_knowledge(self) -> None:
        cols = KNOWLEDGE_COLS
        self.docs = []          # (id, title, doc_type)
        self.runbook_docs = []  # eligible as a similarity match target

        # One runbook per service first: KNOWLEDGE_TILES counts distinct services with
        # a RUNBOOK, and coverage is meaningless if every runbook hangs off one service.
        for index, (title, summary, content) in enumerate(RUNBOOKS):
            sid = self.services[index % len(self.services)][0]
            did = self.uid("knowledge_documents")
            age = self.rng.randint(30, 240)
            self.add("knowledge_documents", cols, (
                did, title, summary, content, "RUNBOOK", "confluence",
                "https://wiki.example.com/runbooks/{}".format(2000 + index),
                "RB-DEMO-{}".format(index), None, sid,
                self.now - timedelta(days=age),
            ))
            self.docs.append((did, title, "RUNBOOK"))
            self.runbook_docs.append((did, title))

        # Then the other document types, so document_type_count covers the enum.
        for index, doc_type in enumerate(DOC_TYPES_ROTATION * 3):
            if doc_type == "RUNBOOK":
                continue
            sid = self.services[index % len(self.services)][0]
            did = self.uid("knowledge_documents")
            title = "{} — {}".format(
                doc_type.replace("_", " ").title(),
                SCENARIOS[index % len(SCENARIOS)][1].format(svc="the platform"),
            )
            self.add("knowledge_documents", cols, (
                did, title[:500],
                "Reference material captured from a previous occurrence.",
                "Captured during triage and kept for retrieval.",
                doc_type, "confluence",
                "https://wiki.example.com/docs/{}".format(3000 + index),
                "DOC-DEMO-{}".format(index), None, sid,
                self.now - timedelta(days=self.rng.randint(10, 300)),
            ))
            self.docs.append((did, title, doc_type))
            self.runbook_docs.append((did, title))

    # -- the time distribution
    #
    # Uniform arrivals make a flat volume chart, which is the one shape real traffic
    # never has. This is a weekday/diurnal curve plus one deliberate storm day, so the
    # chart has a story and the medians vary per bucket.

    def pick_created_at(self, index: int, total: int) -> datetime:
        days = self.args.days
        storm_day = max(2, days // 3)
        for _ in range(24):
            offset_days = self.rng.random() * days
            day = self.now - timedelta(days=offset_days)
            weight = 0.45 if day.weekday() >= 5 else 1.0
            hour = day.hour
            weight *= 0.35 if hour < 6 else (1.25 if 9 <= hour <= 18 else 0.7)
            if abs(offset_days - storm_day) < 0.45:
                weight *= 4.0  # the storm
            if self.rng.random() <= weight / 1.25:
                return day
        return self.now - timedelta(days=self.rng.random() * days)

    # -- incidents

    def build(self) -> None:
        self.build_services()
        self.build_knowledge()

        inc_cols = ["id", "external_id", "title", "description", "status", "priority",
                    "category", "source", "service_id", "environment", "assigned_to",
                    "is_known_incident", "confidence_score", "created_at", "resolved_at",
                    "resolution_summary"]
        ev_cols = ["id", "incident_id", "event_type", "description", "payload",
                   "created_at", "created_by"]
        run_cols = ["id", "incident_id", "agent_id", "status", "input", "output",
                    "confidence_score", "started_at", "finished_at", "error_message",
                    "tokens_input", "tokens_output", "latency_ms", "model", "prompt_version"]
        act_cols = ["id", "incident_id", "agent_run_id", "action_type", "description",
                    "parameters", "risk_level", "confidence_score", "approval_required",
                    "approved_by", "approved_at", "status", "created_at", "updated_at"]
        exec_cols = ["id", "recommended_action_id", "started_at", "finished_at", "status",
                     "request_payload", "response_payload", "execution_logs",
                     "error_message", "executed_by", "created_at"]
        sim_cols = ["id", "incident_id", "knowledge_document_id", "similarity_score",
                    "match_type", "created_at"]

        self.feedback_targets = []  # (incident_id, action_id|None, category, priority)

        for index in range(self.args.incidents):
            created = self.pick_created_at(index, self.args.incidents)
            age_hours = (self.now - created).total_seconds() / 3600.0

            scenario = SCENARIOS[self.rng.randrange(len(SCENARIOS))]
            category, title_t, description, action_type, action_desc, params, resolution = scenario
            service_id, service_slug, service_name = self.services[
                self.rng.randrange(len(self.services))
            ]

            priority = self.rng.choices(["P1", "P2", "P3", "P4"], [8, 24, 45, 23])[0]
            environment = self.rng.choices(
                ["Production", "Staging", "Development"], [72, 18, 10]
            )[0]
            source = self.rng.choices(
                ["PagerDuty", "Email", "Slack", "API", "Manual"], [38, 22, 18, 14, 8]
            )[0]

            # 6% never get classified — that is the funnel's first drop, and it gives
            # BY_CATEGORY its 'Uncategorised' bucket.
            classified = self.rng.random() > 0.06
            if not classified:
                self.stats["uncategorised"] += 1

            iid = self.uid("incidents")
            title = title_t.format(svc=service_slug)

            # --- retrieval and the known/unknown decision.
            #
            # The flag is DERIVED from the best score against the threshold, never
            # rolled independently: the incident list renders both, and a row reading
            # "known" next to a 0.20 match is indistinguishable from a bug.
            matches = []
            if classified:
                wants_known = self.rng.random() < 0.60
                count = self.rng.randint(1, 4) if wants_known else self.rng.randint(0, 2)
                for rank in range(count):
                    doc_id, doc_title = self.runbook_docs[
                        self.rng.randrange(len(self.runbook_docs))
                    ]
                    if wants_known and rank == 0:
                        score = self.q(self.rng.uniform(self.threshold + 0.02, 0.97), 5)
                    else:
                        top = self.threshold - 0.03 if not wants_known else 0.94
                        score = self.q(self.rng.uniform(0.18, max(0.20, top)), 5)
                    matches.append((doc_id, doc_title, score))
                matches.sort(key=lambda m: m[2], reverse=True)

            best = matches[0][2] if matches else None
            is_known = best is not None and best >= self.threshold
            if is_known:
                self.stats["known"] += 1
            confidence = self.q(best) if best is not None else (
                self.q(self.rng.uniform(0.18, 0.45)) if classified else None
            )

            # --- how far the lifecycle got. Older incidents have had time to finish;
            # recent ones are mid-flight. This is what makes "open now" and MTTR both
            # look sensible at the same time.
            recommended = is_known and self.rng.random() < 0.86
            if not is_known and classified and self.rng.random() < 0.12:
                recommended = True  # an unknown incident can still get a proposal

            timeline = created
            events: list[tuple] = []
            runs: list[tuple] = []

            def step(minutes_low: int, minutes_high: int) -> datetime:
                nonlocal timeline
                timeline = timeline + timedelta(
                    seconds=self.rng.randint(minutes_low * 60, minutes_high * 60)
                )
                # Nothing may be stamped in the future: a run finishing after now()
                # shows up as a negative age in the drawer.
                if timeline > self.now:
                    timeline = self.now
                return timeline

            def emit_event(event_type: str, description_text: str, payload, actor: str) -> None:
                events.append((
                    self.uid("incident_events"), iid, event_type, description_text,
                    payload, timeline, actor,
                ))

            def emit_run(agent: str, status: str, inp, out, conf, error=None) -> str:
                mean_latency, spread, tin, tout, model = AGENT_PROFILE[agent]
                latency = self.jitter(mean_latency, spread, 120)
                started = timeline
                # A RUNNING run has not finished, so it has neither a finish time nor
                # a measured latency. Filling those in would make it indistinguishable
                # from a completed one in v_agent_performance's averages.
                if status == "RUNNING":
                    finished = None
                    latency = None
                else:
                    finished = min(started + timedelta(milliseconds=latency), self.now)
                rid = self.uid("agent_runs")
                runs.append((
                    rid, iid, Raw("(SELECT id FROM agents WHERE name = {})".format(lit(agent))),
                    status, inp, out,
                    None if conf is None else self.q(conf),
                    started, finished, error,
                    self.jitter(tin, tin // 4, 50), self.jitter(tout, tout // 4, 20),
                    latency, model, PROMPT_VERSION.get(agent),
                ))
                return rid

            # Intake.
            emit_event("INCIDENT_CREATED",
                       "Incident received from {}.".format(source),
                       {"source": source, "external_id": "DEMO-{}".format(10000 + index)},
                       "Incident Intake Agent")
            emit_run("Incident Intake Agent", "SUCCESS",
                     {"source": source, "subject": title}, {"parsed": True}, None)

            if source == "Email":
                step(0, 1)
                emit_event("EMAIL_RECEIVED", "Inbound email parsed into an incident.",
                           {"source": "Email"}, "Incident Intake Agent")

            # Classification.
            if classified:
                step(1, 4)
                # The classifier's own confidence, not the retrieval score. They are
                # different judgements and the drawer shows them on different rows.
                emit_run("Classification Agent", "SUCCESS", {"title": title},
                         {"category": category, "priority": priority},
                         self.q(self.rng.uniform(0.62, 0.98)))
                emit_event("INCIDENT_CLASSIFIED",
                           "Classified as {} / {}.".format(category, priority),
                           {"category": category, "priority": priority},
                           "Classification Agent")

                # Retrieval.
                step(1, 3)
                emit_event("RAG_SEARCH_STARTED",
                           "Searching the knowledge base for similar incidents.",
                           {"top_k": 8}, "RAG Retrieval Agent")
                retrieval_status = "SUCCESS" if self.rng.random() > 0.03 else "FAILED"
                step(1, 2)
                if retrieval_status == "FAILED":
                    emit_run("RAG Retrieval Agent", "FAILED", {"query": title}, None, None,
                             "Retrieval timed out after 30s: no response from RAG Core.")
                    # Retrieval produced nothing, so nothing downstream may claim it
                    # did — including the confidence score, which IS the match score.
                    matches = []
                    best = None
                    is_known = False
                    confidence = None
                    recommended = False
                else:
                    emit_run("RAG Retrieval Agent", "SUCCESS", {"query": title},
                             {"hits": len(matches), "best_score": best}, best)
                    emit_event("RAG_SEARCH_COMPLETED",
                               "{} result(s) returned.".format(len(matches)),
                               {"hits": len(matches)}, "RAG Retrieval Agent")
                    if is_known:
                        emit_event("SIMILAR_INCIDENT_FOUND",
                                   "Matched \"{}\" at {:.2f} — marked as a known incident."
                                   .format(matches[0][1][:80], best),
                                   {"knowledge_document_id": matches[0][0],
                                    "similarity_score": best},
                                   "RAG Retrieval Agent")

            for doc_id, _, score in matches:
                self.add("similarity_matches", sim_cols, (
                    self.uid("similarity_matches"), iid, doc_id, score, "SEMANTIC", timeline,
                ))

            # Decision and the action.
            action_id = None
            execution_ok = False
            terminal_stage = "triage"
            if recommended:
                step(1, 3)
                decision_run = emit_run(
                    "Decision Agent", "SUCCESS", {"title": title},
                    {"proposed": True, "action_type": action_type}, confidence,
                )
                risk = {"SQL": "LOW", "API": "MEDIUM", "SCRIPT": "MEDIUM",
                        "KUBERNETES": "MEDIUM", "LAMBDA": "HIGH",
                        "GITHUB_PR": "HIGH"}[action_type]
                # Auto-execution needs low risk AND high confidence together — that
                # pairing is exactly what the "fully automated" tile claims. MEDIUM is
                # eligible only at much higher confidence, which is how these policies
                # are actually written.
                #
                # The rates matter: too strict and autoExecutedCountInRange lands on
                # zero, which makes the alert strip, the approval screen's empty state
                # and the automation-rate tile all report that the product does not do
                # the thing it exists to do.
                score = confidence or 0
                auto = (
                    (risk == "LOW" and score >= 0.70 and self.rng.random() < 0.75)
                    or (risk == "MEDIUM" and score >= 0.85 and self.rng.random() < 0.40)
                )
                action_id = self.uid("recommended_actions")
                resolved_params = json.loads(
                    json.dumps(params).replace("{svc}", service_slug)
                )
                emit_event("ACTION_RECOMMENDED",
                           "{} proposed · risk {} — {}".format(action_type, risk, action_desc),
                           {"recommended_action_id": action_id}, "Decision Agent")
                proposed_at = timeline

                if action_type == "GITHUB_PR":
                    step(1, 6)
                    emit_run("Change Delivery Agent", "SUCCESS",
                             {"repo": resolved_params.get("repo")},
                             {"branch": "remediate/inc-{}".format(10000 + index),
                              "applied": True}, confidence)

                # Outcome. `auto` skips approval entirely; otherwise a human decides,
                # and a share of proposals are still waiting — that is the queue.
                # Pending is a function of age, and sharply so. A flat pending rate
                # leaves three-week-old approvals in the queue, which makes the alert
                # strip's "oldest pending" read in days — and nobody leaves a P1
                # remediation waiting that long. Past 72 hours somebody has decided.
                if auto:
                    outcome = "auto"
                # The queue's size tracks the ARRIVAL RATE, not the corpus size: only
                # incidents younger than 72 hours can still be pending, and that is a
                # small slice of a three-week corpus. Hence the high shares here —
                # anything that arrived in the last few hours genuinely has not been
                # decided yet. If the queue still looks thin, raise --incidents (more
                # arrivals per day) or lower --days, rather than stretching the ages.
                elif age_hours < 12:
                    outcome = self.rng.choices(
                        ["pending", "approved", "rejected"], [80, 16, 4])[0]
                elif age_hours < 72:
                    outcome = self.rng.choices(
                        ["pending", "approved", "rejected"], [34, 53, 13])[0]
                else:
                    outcome = self.rng.choices(["approved", "rejected"], [84, 16])[0]

                approver = self.rng.choice(ENGINEERS)
                if outcome == "pending":
                    self.stats["pending_approvals"] += 1
                    terminal_stage = "awaiting_approval"
                    self.add("recommended_actions", act_cols, (
                        action_id, iid, decision_run, action_type, action_desc,
                        resolved_params, risk, confidence, True, None, None, "PROPOSED",
                        proposed_at, proposed_at,
                    ))
                    step(1, 4)
                    emit_event("DEVELOPER_NOTIFIED",
                               "Paged {} — approval required for a {} risk action."
                               .format(service_name, risk), {}, "system")
                elif outcome == "rejected":
                    step(5, 90)
                    rejected_at = timeline
                    terminal_stage = "rejected"
                    self.add("recommended_actions", act_cols, (
                        action_id, iid, decision_run, action_type, action_desc,
                        resolved_params, risk, confidence, True, approver, rejected_at,
                        "REJECTED", proposed_at, rejected_at,
                    ))
                    emit_event("ACTION_REJECTED",
                               "Rejected by {} — proposed change is not reversible here."
                               .format(approver),
                               {"recommended_action_id": action_id}, approver)
                    self.feedback_targets.append((iid, action_id, None, None))
                else:
                    approved_at = None
                    if outcome == "approved":
                        step(3, 70)
                        approved_at = timeline
                        emit_event("ACTION_APPROVED",
                                   "Approved by {} — {}".format(approver, action_desc),
                                   {"recommended_action_id": action_id}, approver)

                    # Execution. The Execution Agent gets a run of its own, not just an
                    # executed_actions row: v_agent_performance groups by agent, and an
                    # agent that only ever appears as `executed_by` renders as an empty
                    # row in the agent-health panel.
                    step(1, 3)
                    exec_started = timeline
                    duration_min = self.rng.randint(1, 9)
                    still_running = age_hours < 0.5 and self.rng.random() < 0.35
                    if still_running:
                        exec_status = "RUNNING"
                    else:
                        exec_status = self.rng.choices(
                            ["SUCCESS", "FAILED", "ROLLED_BACK"], [80, 13, 7]
                        )[0]
                    exec_finished = None if exec_status == "RUNNING" else min(
                        exec_started + timedelta(minutes=duration_min), self.now
                    )

                    self.add("recommended_actions", act_cols, (
                        action_id, iid, decision_run, action_type, action_desc,
                        resolved_params, risk, confidence,
                        not auto,
                        None if auto else approver,
                        None if auto else approved_at,
                        "EXECUTED",
                        proposed_at, exec_finished or exec_started,
                    ))

                    error = None
                    logs = "Invoked {} against {}.".format(action_type, service_slug)
                    response = {"statusCode": 200}
                    if exec_status == "FAILED":
                        error = ("Timed out waiting for the change to confirm; "
                                 "{} still reporting errors.".format(service_slug))
                        response = {"statusCode": 503, "errorType": "Timeout"}
                        self.stats["failed_executions"] += 1
                    elif exec_status == "ROLLED_BACK":
                        logs += " Change re-introduced the fault; rolled back to the prior state."
                        response = {"statusCode": 200, "rolled_back": True}
                        self.stats["rolled_back"] += 1
                    elif exec_status == "RUNNING":
                        logs = None
                        response = None
                        self.stats["running"] += 1

                    self.add("executed_actions", exec_cols, (
                        self.uid("executed_actions"), action_id, exec_started, exec_finished,
                        exec_status, resolved_params, response, logs, error,
                        "Execution Agent", exec_started,
                    ))
                    emit_run("Execution Agent",
                             "RUNNING" if exec_status == "RUNNING"
                             else ("SUCCESS" if exec_status != "FAILED" else "FAILED"),
                             resolved_params,
                             None if exec_status == "RUNNING" else response,
                             None, error)

                    if exec_finished:
                        timeline = exec_finished
                    # Exactly what app/agents/execution.py emits: ACTION_EXECUTED on
                    # success, VALIDATION_FAILED otherwise. There is no separate
                    # validation event and no Validation Agent run, because there is
                    # no Validation Agent — docs/architecture.md records it as
                    # registered but not implemented, which is why the funnel's last
                    # stage reads "Not yet available" instead of a fabricated zero.
                    # Seeding runs for it would manufacture a capability the platform
                    # does not have, and the agent-health panel would report it as
                    # shipped.
                    if exec_status == "SUCCESS":
                        emit_event("ACTION_EXECUTED",
                                   "{} executed — {}".format(action_type, action_desc),
                                   {"status": exec_status}, "Execution Agent")
                    elif exec_status == "RUNNING":
                        emit_event("ACTION_EXECUTED",
                                   "{} invoked — execution in progress.".format(action_type),
                                   {"status": exec_status}, "Execution Agent")
                    else:
                        emit_event("VALIDATION_FAILED",
                                   "{} failed — {}".format(
                                       action_type,
                                       error or "change rolled back to the prior state."),
                                   {"status": exec_status}, "Execution Agent")
                    if auto:
                        self.stats["auto_executed"] += 1

                    execution_ok = exec_status == "SUCCESS"
                    terminal_stage = "executed" if execution_ok else "execution_failed"

            # --- final status. Derived from the furthest stage reached, so status,
            # resolved_at and the timeline can never disagree.
            resolved_at = None
            resolution_summary = None
            # Declared before the status block, which assigns it on the automated
            # path too. Initialising it lower down silently discarded that.
            manual_resolver = None
            if execution_ok and self.rng.random() < 0.88:
                step(1, 12)
                resolved_at = min(timeline, self.now)
                resolution_summary = resolution
                status = "CLOSED" if age_hours > 48 and self.rng.random() < 0.45 else "RESOLVED"
                # A person closes it, not the Validation Agent: nothing in the
                # pipeline confirms a remediation worked, so the confirmation is
                # human by definition.
                manual_resolver = self.rng.choice(ENGINEERS)
                emit_event("RESOLVED", resolution, {}, manual_resolver)
                if status == "CLOSED":
                    step(30, 600)
                    emit_event("CLOSED", "Incident closed after review.", {}, "system")
                self.stats["resolved"] += 1
            elif terminal_stage == "execution_failed" or (
                priority == "P1" and age_hours > 1 and self.rng.random() < 0.5
            ):
                status = "ESCALATED"
                emit_event("ESCALATED",
                           "Automated remediation did not resolve the incident — escalated.",
                           {}, "system")
            elif not classified:
                status = "OPEN"
            elif terminal_stage == "awaiting_approval":
                status = "INVESTIGATING"
            elif terminal_stage == "executed":
                status = "MITIGATED"
            else:
                # No action was ever executed here, so MITIGATED is not available:
                # it would claim a remediation the timeline cannot show.
                status = self.rng.choices(["OPEN", "INVESTIGATING"], [52, 48])[0]

            # --- resolved by a person, with no automation involved.
            #
            # Without this path an incident can only ever be resolved by a successful
            # agent execution, which requires a RAG match — so nothing unknown is ever
            # resolved, and three things break at once: the resolution rate sits at
            # about 20%, the Knowledge tab's undocumented-resolutions tile (K1 counts
            # resolved AND NOT is_known) reads zero, and the Knowledge Generation Agent
            # never runs because it only fires on exactly that combination.
            #
            # A real queue drains by hand. Age is what drives it: today's incidents are
            # still open, last week's mostly are not.
            if status not in ("RESOLVED", "CLOSED"):
                # Tuned so the overall resolution rate lands near 70%, not 90%. A queue
                # where almost everything is closed leaves the Now tab with nothing to
                # show, and some incidents genuinely do linger for weeks.
                if age_hours < 6:
                    chance = 0.05
                elif age_hours < 24:
                    chance = 0.30
                elif age_hours < 72:
                    chance = 0.55
                else:
                    chance = 0.72
                if self.rng.random() < chance:
                    step(20, 600)
                    resolved_at = min(timeline, self.now)
                    resolver = manual_resolver = self.rng.choice(ENGINEERS)
                    resolution_summary = (
                        "Resolved manually by {}. {}".format(resolver, resolution)
                        if is_known else
                        "Diagnosed and fixed by hand — no runbook covered this. {}"
                        .format(resolution)
                    )
                    status = "CLOSED" if age_hours > 72 and self.rng.random() < 0.5 else "RESOLVED"
                    emit_event("RESOLVED", resolution_summary, {}, resolver)
                    if status == "CLOSED":
                        step(30, 900)
                        emit_event("CLOSED", "Incident closed after review.", {}, "system")
                    self.stats["resolved"] += 1

            # A resolved incident with an unresolved-looking status, or the reverse,
            # breaks every open-count on the dashboard. Keep them in lockstep.
            if resolved_at is None and status in ("RESOLVED", "CLOSED"):
                status = "MITIGATED"
            if resolved_at is not None and status not in ("RESOLVED", "CLOSED"):
                resolved_at = None
                resolution_summary = None

            # Whoever resolved it by hand is who it was assigned to — the RESOLVED
            # event names a person, and the drawer showing a different owner beside it
            # reads as a data error.
            if manual_resolver is not None:
                assigned = manual_resolver
            elif status in ("RESOLVED", "CLOSED", "MITIGATED", "ESCALATED"):
                assigned = self.rng.choice(ENGINEERS)
            elif self.rng.random() < 0.35:
                assigned = self.rng.choice(ENGINEERS)
            else:
                assigned = None

            self.add("incidents", inc_cols, (
                iid, "DEMO-{}".format(10000 + index), title, description, status,
                priority, category if classified else None, source, service_id,
                environment, assigned, is_known, confidence, created, resolved_at,
                resolution_summary,
            ))

            # An incident resolved with no runbook behind it is the documentation
            # backlog the Knowledge tab is built to surface.
            if resolved_at and not is_known and self.rng.random() < 0.55:
                step(2, 20)
                emit_run("Knowledge Generation Agent", "SUCCESS", {"incident": iid},
                         {"document_created": True}, self.q(self.rng.uniform(0.7, 0.95)))
                did = self.uid("knowledge_documents")
                self.add("knowledge_documents", KNOWLEDGE_COLS,
                         (did, "INC — {}".format(title)[:500], resolution,
                          "{}\n\nResolution: {}".format(description, resolution),
                          "INCIDENT", "orchestrator",
                          "https://dashboard.example.com/?incident={}".format(iid),
                          "INC-DEMO-{}".format(index), iid, service_id, resolved_at))

            for row in events:
                self.add("incident_events", ev_cols, row)
            for row in runs:
                self.add("agent_runs", run_cols, row)

            if self.rng.random() < 0.22:
                self.feedback_targets.append((
                    iid, None,
                    category if (classified and self.rng.random() < 0.5) else None,
                    priority if self.rng.random() < 0.4 else None,
                ))

        self.build_feedback()

    def build_feedback(self) -> None:
        """Human judgements on AI output.

        Volume matters here for a specific reason: /api/feedback/impact suppresses
        itself below SUPPRESSION_FLOOR team corrections *in the current calendar
        quarter*. Too few and the widget renders its suppressed state, which looks
        identical to a bug. So these are dated inside the current quarter.
        """
        cols = ["id", "incident_id", "agent_run_id", "recommended_action_id",
                "feedback_type", "comments", "corrected_category", "corrected_priority",
                "corrected_resolution", "created_by", "created_at"]
        quarter_start = datetime(
            self.now.year, ((self.now.month - 1) // 3) * 3 + 1, 1, tzinfo=self.now.tzinfo
        )
        span = max(1.0, (self.now - quarter_start).total_seconds())

        rejection_comments = [
            "Not reversible here and no snapshot is staged.",
            "Right diagnosis, wrong blast radius — this touches the write path.",
            "Needs a maintenance window; declining for now.",
            "The runbook it matched covers a different failure mode.",
        ]
        approval_comments = [
            "Classification and remediation both correct.",
            "Matched the right runbook.",
            "Scaling was the right call here.",
            "Good catch — this is the same failure as last month.",
        ]
        for incident_id, action_id, corrected_category, corrected_priority in self.feedback_targets:
            if action_id is not None:
                feedback_type = "REJECTED"
                comments = self.rng.choice(rejection_comments)
            elif corrected_category or corrected_priority:
                feedback_type = "CORRECTED"
                comments = "Reclassified after review."
            else:
                feedback_type = "APPROVED"
                comments = self.rng.choice(approval_comments)

            created = quarter_start + timedelta(seconds=self.rng.random() * span)
            self.add("developer_feedback", cols, (
                self.uid("developer_feedback"), incident_id, None, action_id,
                feedback_type, comments, corrected_category, corrected_priority,
                "Documented the working fix for next time." if feedback_type == "CORRECTED"
                and self.rng.random() < 0.4 else None,
                self.rng.choice(ENGINEERS), created,
            ))

    # -- emission

    def statements(self) -> list[str]:
        # Topological order, and every step of it is load-bearing:
        #   services            <- nothing
        #   incidents           <- services
        #   knowledge_documents <- incidents (the docs the Knowledge Generation Agent
        #                          writes from a resolved incident carry incident_id),
        #                          services
        #   similarity_matches  <- incidents, knowledge_documents
        #   incident_events     <- incidents
        #   agent_runs          <- incidents, agents (already seeded)
        #   recommended_actions <- incidents, agent_runs
        #   executed_actions    <- recommended_actions
        #   developer_feedback  <- incidents, recommended_actions
        order = ["services", "incidents", "knowledge_documents", "similarity_matches",
                 "incident_events", "agent_runs", "recommended_actions",
                 "executed_actions", "developer_feedback"]
        out = []
        for table in order:
            if table not in self.tables:
                continue
            columns, rows = self.tables[table]
            out.extend(insert_statements(table, columns, rows))
        return out

    def row_counts(self) -> dict[str, int]:
        return {table: len(rows) for table, (_, rows) in self.tables.items()}


# --- reporting -------------------------------------------------------------

SUMMARY_SQL = """
SELECT
  (SELECT count(*) FROM incidents)                                             AS incidents,
  (SELECT count(*) FROM incidents WHERE status NOT IN ('RESOLVED','CLOSED'))   AS open,
  (SELECT count(*) FROM incidents WHERE is_known_incident)                     AS known,
  (SELECT count(*) FROM incidents WHERE resolved_at IS NOT NULL)               AS resolved,
  (SELECT count(*) FROM recommended_actions
     WHERE status = 'PROPOSED' AND approval_required)                          AS pending_approvals,
  (SELECT count(*) FROM executed_actions)                                      AS executions,
  (SELECT count(*) FROM executed_actions WHERE status = 'FAILED')              AS failed_exec,
  (SELECT count(*) FROM incident_events)                                       AS events,
  (SELECT count(*) FROM agent_runs)                                            AS agent_runs,
  (SELECT count(*) FROM knowledge_documents)                                   AS documents,
  (SELECT count(*) FROM similarity_matches)                                    AS matches,
  (SELECT count(*) FROM developer_feedback)                                    AS feedback,
  (SELECT count(*) FROM services)                                              AS services
"""

# The checks that matter: each of these returning non-zero means a panel would
# render something self-contradictory.
CONSISTENCY_SQL = """
SELECT
  (SELECT count(*) FROM incidents i
    WHERE i.is_known_incident
      AND COALESCE((SELECT max(similarity_score) FROM similarity_matches sm
                     WHERE sm.incident_id = i.id), 0) < {threshold})            AS known_without_match,
  (SELECT count(*) FROM incidents
    WHERE resolved_at IS NOT NULL AND status NOT IN ('RESOLVED','CLOSED'))      AS resolved_but_open,
  (SELECT count(*) FROM incidents
    WHERE resolved_at IS NULL AND status IN ('RESOLVED','CLOSED'))              AS closed_without_time,
  (SELECT count(*) FROM incidents WHERE resolved_at < created_at)               AS resolved_before_created,
  (SELECT count(*) FROM executed_actions
    WHERE finished_at IS NOT NULL AND finished_at < started_at)                 AS finished_before_started,
  (SELECT count(*) FROM recommended_actions
    WHERE (approved_by IS NULL) <> (approved_at IS NULL))                       AS half_approvals,
  (SELECT count(*) FROM incidents WHERE created_at > now())                     AS created_in_future,
  (SELECT count(*) FROM agent_runs WHERE finished_at > now() + INTERVAL '1 minute') AS runs_in_future,
  -- Validation Agent is excluded on purpose: docs/architecture.md records it as
  -- registered but not implemented, so it SHOULD have no runs. Seeding some would
  -- report an unbuilt capability as shipped.
  (SELECT count(*) FROM agents a
    WHERE a.name <> 'Validation Agent'
      AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.agent_id = a.id))      AS agents_without_runs,
  -- The other half of the same rule: nothing may claim the validator ran.
  (SELECT count(*) FROM agent_runs r JOIN agents a ON a.id = r.agent_id
    WHERE a.name = 'Validation Agent')                                          AS phantom_validator_runs,
  (SELECT count(*) FROM incident_events
    WHERE event_type IN ('VALIDATION_PASSED', 'VALIDATION_STARTED'))            AS phantom_validation_events
"""


# Whether the demo will LOOK full, which is a different question from whether the
# data is correct. Every figure here is what a capped or median-taking panel gets
# for the dashboard's default range, so a shortfall is visible before a demo rather
# than during one. Targets come from the LIMITs in app/queries/dashboard.py.
WINDOW_SQL = """
WITH w AS (SELECT now() - INTERVAL '7 days' AS frm, now() AS ito)
SELECT
  (SELECT count(*) FROM incidents, w
    WHERE created_at >= frm AND created_at < ito)                            AS incidents,
  (SELECT count(DISTINCT date_trunc('day', created_at)) FROM incidents, w
    WHERE created_at >= frm AND created_at < ito)                            AS day_buckets,
  (SELECT count(*) FROM incidents, w
    WHERE created_at >= frm AND created_at < ito AND resolved_at IS NOT NULL) AS resolved_for_median,
  (SELECT count(*) FROM executed_actions e, w
    WHERE e.started_at >= frm AND e.started_at < ito)                        AS executions,
  (SELECT count(*) FROM executed_actions e, w
    WHERE e.status = 'FAILED' AND e.started_at >= frm AND e.started_at < ito) AS recent_failures,
  (SELECT count(DISTINCT ra.action_type) FROM executed_actions e
     JOIN recommended_actions ra ON ra.id = e.recommended_action_id, w
    WHERE e.started_at >= frm AND e.started_at < ito)                        AS action_types,
  (SELECT count(*) FROM recommended_actions
    WHERE status = 'PROPOSED' AND approval_required)                         AS approval_queue,
  (SELECT count(DISTINCT i.service_id) FROM incidents i, w
    WHERE i.created_at >= frm AND i.created_at < ito
      AND i.service_id IS NOT NULL)                                          AS services_in_window,
  (SELECT count(*) FROM (
     SELECT kd.id FROM knowledge_documents kd
       JOIN similarity_matches sm ON sm.knowledge_document_id = kd.id
       JOIN incidents i ON i.id = sm.incident_id, w
      WHERE i.status IN ('RESOLVED','CLOSED')
        AND i.created_at >= frm AND i.created_at < ito
      GROUP BY kd.id) t)                                                     AS docs_driving,
  (SELECT count(*) FROM developer_feedback
    WHERE date_trunc('quarter', created_at) = date_trunc('quarter', now()))  AS feedback_this_quarter,
  (SELECT count(DISTINCT created_by) FROM developer_feedback
    WHERE date_trunc('quarter', created_at) = date_trunc('quarter', now()))  AS engineers_this_quarter,
  (SELECT count(*) FROM executed_actions e
     JOIN recommended_actions ra ON ra.id = e.recommended_action_id, w
    WHERE ra.approval_required = FALSE AND e.status = 'SUCCESS'
      AND e.started_at >= frm)                                               AS auto_executed,
  -- Reported as a ceiling, not a floor: this one must stay SMALL.
  (SELECT COALESCE(round(EXTRACT(EPOCH FROM (now() - min(created_at)))/3600), 0)
     FROM recommended_actions
    WHERE status = 'PROPOSED' AND approval_required)                         AS oldest_pending_hours
"""

# (label, minimum for the panel to render full, why)
WINDOW_TARGETS = [
    ("incidents in range", 40, "volume chart and every tile"),
    ("day buckets covered", 7, "one bar per day"),
    ("resolutions for median", 12, "percentile_cont needs a distribution"),
    ("executions in range", 12, "outcomes panel"),
    ("failed executions", 5, "RECENT_FAILURES is LIMIT 5"),
    ("action types executed", 4, "outcomes by action type"),
    ("approval queue", 5, "the approvals screen"),
    ("services in range", 5, "BY_SERVICE is LIMIT 5"),
    ("documents driving resolutions", 10, "that panel is LIMIT 10"),
    ("feedback this quarter", 10, "below this the impact widget self-suppresses"),
    ("engineers this quarter", 3, "team figures"),
    ("auto-executed in range", 3, "alert strip and the automation-rate tile"),
]

# Checked as a maximum instead of a minimum: a queue whose oldest item is three weeks
# old is not a busy queue, it is a broken one.
WINDOW_CEILINGS = [("oldest pending approval (h)", 96, "nobody waits four days")]


def report_window(db) -> int:
    print("\npanel fill for the default 7-day range")
    values = db.rows(WINDOW_SQL)[0]
    short = 0
    for (label, target, why), value in zip(WINDOW_TARGETS, values):
        ok = (value or 0) >= target
        short += 0 if ok else 1
        print("  {}{:<32} {:<6} (need {:<3}) {}".format(
            "ok " if ok else "LOW", label, value, target, "" if ok else "- " + why))
    for (label, ceiling, why), value in zip(WINDOW_CEILINGS, values[len(WINDOW_TARGETS):]):
        ok = (value or 0) <= ceiling
        short += 0 if ok else 1
        print("  {}{:<32} {:<6} (max  {:<3}) {}".format(
            "ok " if ok else "HIGH", label, value, ceiling, "" if ok else "- " + why))
    if short:
        print("  {} panel(s) would render under-filled - raise --incidents".format(short))
    return short


def report(db, threshold: float) -> None:
    labels = ["incidents", "open", "known", "resolved", "pending approvals", "executions",
              "failed executions", "events", "agent runs", "knowledge documents",
              "similarity matches", "feedback rows", "services"]
    print("\ndatabase contents")
    for label, value in zip(labels, db.rows(SUMMARY_SQL)[0]):
        print("  {:<22} {}".format(label, value))

    checks = ["known without a qualifying match", "resolved but status open",
              "closed without resolved_at", "resolved before created",
              "finished before started", "half-written approvals",
              "created in the future", "runs in the future",
              "implemented agents with no runs", "phantom validator runs",
              "phantom validation events"]
    print("\nconsistency (every one must be 0)")
    failures = 0
    for label, value in zip(checks, db.rows(CONSISTENCY_SQL.format(threshold=threshold))[0]):
        flag = "ok " if value == 0 else "!! "
        failures += 0 if value == 0 else 1
        print("  {}{:<34} {}".format(flag, label, value))
    print("  {} check(s) failing".format(failures))

    print("\nvolume per day (last 10 buckets)")
    for bucket, known, unknown, median in db.rows("""
        SELECT date_trunc('day', created_at)::date::text,
               count(*) FILTER (WHERE is_known_incident),
               count(*) FILTER (WHERE NOT is_known_incident),
               round(percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at))/60
               ) FILTER (WHERE resolved_at IS NOT NULL))
        FROM incidents GROUP BY 1 ORDER BY 1 DESC LIMIT 10
    """):
        print("  {}  known={:<4} unknown={:<4} median_ttr={}".format(
            bucket, known, unknown, "-" if median is None else "{}m".format(median)))

    print("\nagent health")
    for name, runs, ok, failed, latency in db.rows("""
        SELECT a.name, count(r.id),
               count(*) FILTER (WHERE r.status = 'SUCCESS'),
               count(*) FILTER (WHERE r.status = 'FAILED'),
               round(avg(r.latency_ms))
        FROM agents a LEFT JOIN agent_runs r ON r.agent_id = a.id
        GROUP BY a.name ORDER BY count(r.id) DESC
    """):
        print("  {:<30} runs={:<5} ok={:<5} failed={:<4} avg={}ms".format(
            name, runs, ok, failed, latency if latency is not None else "-"))

    report_window(db)


# --- main ------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    # 480 over 21 days is about 23 arrivals a day, and it is chosen rather than
    # guessed: the binding constraint is the approval queue, which can only hold
    # incidents younger than 72 hours, so it scales with the ARRIVAL RATE while every
    # other panel scales with the corpus. 480 is the smallest round number where the
    # queue clears 5 with margin and nothing else is close to its floor. --summary
    # reports every one of those floors, so a different corpus can be checked rather
    # than assumed.
    parser.add_argument("--incidents", type=int, default=480,
                        help="how many incidents to generate (default 480 - the "
                             "smallest corpus that fills every panel, the approval "
                             "queue being the binding constraint)")
    parser.add_argument("--days", type=int, default=21,
                        help="how far back they spread (default 21; the dashboard's "
                             "default range is 7, so this leaves a previous period "
                             "for the period-over-period deltas to compare against)")
    parser.add_argument("--seed", type=int, default=20260820,
                        help="RNG seed — same seed, same corpus")
    parser.add_argument("--threshold", type=float, default=None,
                        help="known-incident similarity threshold; defaults to "
                             "app/config.py's known_incident_threshold")
    parser.add_argument("--out", metavar="FILE",
                        help="write the SQL to FILE instead of executing it "
                             "(needs no database connection)")
    parser.add_argument("--purge", action="store_true",
                        help="delete only the rows this script wrote, then exit")
    parser.add_argument("--summary", action="store_true",
                        help="report what is in the database, then exit")
    parser.add_argument("-y", "--yes", action="store_true", help="skip the confirmation")
    args = parser.parse_args()

    if args.incidents < 1 or args.days < 1:
        raise SystemExit("error: --incidents and --days must both be positive")

    threshold = args.threshold
    if threshold is None:
        try:
            sys.path.insert(0, str(DB_DIR.parent))
            from app.config import settings
            threshold = settings.known_incident_threshold
        except Exception:
            # app/ needs pydantic-settings; the generator should not.
            threshold = 0.50
    if not 0 < threshold < 1:
        raise SystemExit("error: --threshold must be between 0 and 1")

    # --out needs no connection at all, so it works with no driver and no network.
    if args.out and not (args.purge or args.summary):
        corpus = Corpus(datetime.now().astimezone(), args, threshold)
        corpus.build()
        statements = corpus.statements()
        text = "\n\n".join(
            ["-- Generated by db/seed_demo.py"
             " --incidents {} --days {} --seed {}".format(
                 args.incidents, args.days, args.seed),
             "-- Timestamps are absolute, anchored at generation time.",
             "BEGIN;"] + statements + ["COMMIT;"]
        )
        pathlib.Path(args.out).write_text(text + "\n", encoding="utf-8")
        print("wrote {} ({} statements)".format(args.out, len(statements)))
        for table, count in sorted(corpus.row_counts().items()):
            print("  {:<22} {}".format(table, count))
        return 0

    migrate = load_migrate()
    url = migrate.resolve_database_url()
    db = migrate.connect(url)
    try:
        print("database: {}".format(migrate.redact(url)))

        if not db.scalar("SELECT to_regclass('public.incidents') IS NOT NULL"):
            raise SystemExit("error: schema not present. Run db/migrate.py first.")

        if args.summary:
            report(db, threshold)
            return 0

        if args.purge:
            owned = sum(
                db.scalar("SELECT count(*) FROM {} WHERE id::text LIKE '{}-{}-%'"
                          .format(table, PREFIX[table], MARK))
                for table in PURGE_ORDER
            )
            print("rows written by this script: {}".format(owned))
            if owned == 0:
                print("nothing to purge.")
                return 0
            if not args.yes:
                if input("Type 'purge' to delete them: ").strip() != "purge":
                    print("aborted.")
                    return 1
            with db.transaction():
                for table in PURGE_ORDER:
                    db.execute("DELETE FROM {} WHERE id::text LIKE '{}-{}-%'"
                               .format(table, PREFIX[table], MARK))
            print("purged.")
            report(db, threshold)
            return 0

        if db.scalar("SELECT count(*) FROM agents") == 0:
            raise SystemExit(
                "error: the agent registry is empty, and every agent run references it.\n"
                "fix:   python db/migrate.py --seed 001_agents"
            )

        # Anchor on the DATABASE's clock, not this machine's. A skewed laptop clock
        # would otherwise stamp incidents in the server's future, and every age and
        # "oldest open" reading would come out negative.
        anchor = db.scalar("SELECT now()")
        print("anchor:   {} (database clock)".format(anchor))
        print("plan:     {} incidents over {} days, threshold {}, seed {}".format(
            args.incidents, args.days, threshold, args.seed))

        if not args.yes:
            print("\nThis writes demo data to the database above.")
            print("It is reversible: db/seed_demo.py --purge removes exactly these rows.")
            if input("Type 'seed' to continue: ").strip() != "seed":
                print("aborted.")
                return 1

        corpus = Corpus(anchor, args, threshold)
        corpus.build()
        statements = corpus.statements()
        print("\ngenerated {} statements:".format(len(statements)))
        for table, count in sorted(corpus.row_counts().items()):
            print("  {:<22} {}".format(table, count))

        # One transaction: a partly-loaded corpus would have incidents whose actions
        # are missing, which is exactly the self-contradicting data this avoids.
        print("\nloading...")
        with db.transaction():
            for statement in statements:
                db.execute(statement)
        print("loaded.")

        report(db, threshold)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
