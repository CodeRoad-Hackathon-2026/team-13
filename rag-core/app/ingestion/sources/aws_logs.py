"""AWS CloudWatch Logs connector.

Logs cannot be indexed the way documents are. A busy service emits the same
timeout line ten thousand times an hour; embedding each one costs real money,
floods the index with near-duplicates, and pushes genuinely distinct evidence
out of the top-k. Retrieving "connection timeout" fifty times tells an agent
nothing it did not already know from the first hit.

So this connector indexes *patterns*, not lines. Each event is normalized into
a fingerprint (numbers, UUIDs, hex ids, timestamps, paths and quoted strings
replaced by placeholders), events are grouped by fingerprint within a polling
window, and one document is produced per distinct pattern carrying its
occurrence count and a few verbatim samples.

That turns "10,000 log lines" into "12 distinct failure modes, ranked by
frequency" — which is what an incident agent can actually reason over.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from app.ingestion.pipeline import DocumentInput
from app.ingestion.sources import CheckResult, Field, SourceRun, check, register

logger = logging.getLogger(__name__)

# Order matters: the more specific patterns must run before the numeric one.
_NORMALIZERS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?"), "<TIMESTAMP>"),
    (re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"), "<UUID>"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b"), "<IP>"),
    (re.compile(r"\b0x[0-9a-fA-F]+\b"), "<HEX>"),
    (re.compile(r"\b[0-9a-fA-F]{16,}\b"), "<HASH>"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"), "<EMAIL>"),
    (re.compile(r"/[\w./-]{4,}"), "<PATH>"),
    (re.compile(r'"[^"]{0,200}"'), '"<STR>"'),
    (re.compile(r"\b\d+(?:\.\d+)?(?:ms|s|kb|mb|gb)?\b", re.IGNORECASE), "<NUM>"),
]


def fingerprint(message: str) -> str:
    """Collapse a log line to its structural shape."""
    normalized = message.strip()
    for pattern, placeholder in _NORMALIZERS:
        normalized = pattern.sub(placeholder, normalized)
    return re.sub(r"\s+", " ", normalized)[:500]


def _fetch_events(config: dict, start_ms: int, end_ms: int) -> list[dict]:
    """Blocking boto3 call — invoked via asyncio.to_thread."""
    try:
        import boto3
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("the `boto3` package is required for the aws_logs source") from exc

    session = boto3.session.Session(
        region_name=config.get("region"),
        aws_access_key_id=config.get("aws_access_key_id"),
        aws_secret_access_key=config.get("aws_secret_access_key"),
        aws_session_token=config.get("aws_session_token"),
        profile_name=config.get("profile"),
    )
    client = session.client("logs")

    params = {
        "logGroupName": config["log_group"],
        "startTime": start_ms,
        "endTime": end_ms,
        "limit": min(int(config.get("page_size", 1000)), 10_000),
    }
    if config.get("filter_pattern"):
        params["filterPattern"] = config["filter_pattern"]
    if config.get("log_stream_prefix"):
        params["logStreamNamePrefix"] = config["log_stream_prefix"]

    events: list[dict] = []
    max_events = int(config.get("max_events", 20_000))
    token = None
    while len(events) < max_events:
        if token:
            params["nextToken"] = token
        response = client.filter_log_events(**params)
        events.extend(response.get("events", []))
        token = response.get("nextToken")
        if not token:
            break
    return events[:max_events]


def _describe_log_group(config: dict) -> dict:
    """Blocking boto3 call — invoked via asyncio.to_thread."""
    import boto3

    session = boto3.session.Session(
        region_name=config.get("region"),
        aws_access_key_id=config.get("aws_access_key_id"),
        aws_secret_access_key=config.get("aws_secret_access_key"),
        aws_session_token=config.get("aws_session_token"),
        profile_name=config.get("profile"),
    )
    return session.client("logs").describe_log_groups(
        logGroupNamePrefix=config["log_group"], limit=5
    )


@check("aws_logs")
async def check_aws_logs(config: dict) -> CheckResult:
    """Confirms both credentials and that the log group name is exact.

    `filter_log_events` on a nonexistent group throws deep inside a poll an hour
    later; a prefix describe here catches the typo at save time and can show the
    near-misses, which is usually enough to spot it.
    """
    import asyncio

    result = await asyncio.to_thread(_describe_log_group, config)
    groups = [g["logGroupName"] for g in result.get("logGroups", [])]
    if config["log_group"] in groups:
        return CheckResult(True, f"log group '{config['log_group']}' found", {"groups": groups})
    if groups:
        return CheckResult(
            False,
            f"no log group named exactly '{config['log_group']}'. "
            f"Groups with that prefix: {', '.join(groups)}",
            {"groups": groups},
        )
    return CheckResult(False, f"no log group matching '{config['log_group']}'")


@register(
    "aws_logs",
    label="AWS CloudWatch Logs",
    description=(
        "Collapses log lines into distinct patterns — timestamps, UUIDs and IDs "
        "are replaced with placeholders — so one document is one recurring error, "
        "not one line."
    ),
    docs="docs/sources.md#aws_logs",
    fields=(
        Field(
            "log_group",
            "Log group",
            required=True,
            placeholder="/aws/lambda/payments-api",
            help="Exact name, not a prefix.",
        ),
        Field("region", "Region", placeholder="us-east-1"),
        Field(
            "profile",
            "AWS profile",
            help="Leave every credential field blank to use the worker's IAM role or ambient config.",
        ),
        Field("aws_access_key_id", "Access key ID", type="secret", advanced=True),
        Field("aws_secret_access_key", "Secret access key", type="secret", advanced=True),
        Field("aws_session_token", "Session token", type="secret", advanced=True),
        Field(
            "filter_pattern",
            "Filter pattern",
            placeholder="?ERROR ?Exception",
            help="CloudWatch filter syntax. Without one you index INFO noise as well.",
        ),
        Field("log_stream_prefix", "Log stream prefix", advanced=True),
        Field(
            "lookback_minutes",
            "First-run lookback (minutes)",
            type="number",
            default=60,
        ),
        Field(
            "min_occurrences",
            "Minimum occurrences",
            type="number",
            default=1,
            help="Raise this to drop one-off lines and keep only recurring patterns.",
        ),
        Field("max_patterns", "Max patterns per poll", type="number", default=200, advanced=True),
        Field("sample_lines", "Sample lines per pattern", type="number", default=3, advanced=True),
        Field("max_events", "Max events scanned", type="number", default=20000, advanced=True),
        Field("page_size", "Page size", type="number", default=1000, advanced=True),
        Field("console_url", "Console URL", advanced=True, help="Used as the document link."),
        Field("metadata", "Extra metadata", type="keyvalue", advanced=True),
    ),
)
async def run_aws_logs_source(collection: str, config: dict, cursor: dict) -> SourceRun:
    """config:
      log_group          — required, e.g. /aws/ecs/payments-api
      region             — AWS region
      filter_pattern     — CloudWatch filter, e.g. '?ERROR ?FATAL ?Exception'
      log_stream_prefix  — optional stream filter
      lookback_minutes   — first-run window (default 60)
      min_occurrences    — drop patterns rarer than this (default 1)
      max_patterns       — cap documents per poll (default 200)
      sample_lines       — verbatim examples kept per pattern (default 3)
      aws_access_key_id / aws_secret_access_key / profile — optional; the
        default credential chain (IAM role, env, ~/.aws) is used otherwise
    """
    log_group = config["log_group"]
    now = datetime.now(timezone.utc)
    end_ms = int(now.timestamp() * 1000)

    if cursor.get("end_ms"):
        start_ms = int(cursor["end_ms"])
    else:
        lookback = int(config.get("lookback_minutes", 60))
        start_ms = int((now - timedelta(minutes=lookback)).timestamp() * 1000)
    if start_ms >= end_ms:
        return SourceRun(documents=[], cursor=cursor)

    events = await asyncio.to_thread(_fetch_events, config, start_ms, end_ms)
    if not events:
        return SourceRun(documents=[], cursor={"end_ms": end_ms})

    groups: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        groups[fingerprint(event.get("message", ""))].append(event)

    min_occurrences = int(config.get("min_occurrences", 1))
    max_patterns = int(config.get("max_patterns", 200))
    sample_lines = int(config.get("sample_lines", 3))

    ranked = sorted(groups.items(), key=lambda kv: len(kv[1]), reverse=True)
    window_start = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    window_end = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc)
    window_label = window_start.strftime("%Y-%m-%dT%H:%M")

    documents: list[DocumentInput] = []
    for shape, group in ranked[:max_patterns]:
        if len(group) < min_occurrences:
            continue
        # The fingerprint is stable across windows, so the same failure mode
        # keeps one identity over time instead of fragmenting per poll.
        shape_id = hashlib.sha256(shape.encode()).hexdigest()[:16]
        first = min(e["timestamp"] for e in group)
        last = max(e["timestamp"] for e in group)
        samples = [e.get("message", "").strip() for e in group[:sample_lines]]
        streams = sorted({e.get("logStreamName", "") for e in group})[:5]

        body = "\n".join(
            [
                f"# Log pattern in {log_group}",
                "",
                f"**Occurrences:** {len(group)} between "
                f"{datetime.fromtimestamp(first / 1000, tz=timezone.utc):%Y-%m-%d %H:%M:%S} and "
                f"{datetime.fromtimestamp(last / 1000, tz=timezone.utc):%Y-%m-%d %H:%M:%S} UTC",
                f"**Streams:** {', '.join(s for s in streams if s)}" if streams else "",
                "",
                "## Pattern",
                "",
                "```",
                shape,
                "```",
                "",
                "## Sample lines",
                "",
                "```",
                "\n".join(samples),
                "```",
            ]
        )

        documents.append(
            DocumentInput(
                collection=collection,
                external_id=f"{log_group}:{shape_id}:{window_label}",
                content=body,
                title=f"{log_group} — {shape[:80]}",
                uri=config.get("console_url"),
                source_type="aws_logs",
                metadata={
                    **(config.get("metadata") or {}),
                    "kind": "log_pattern",
                    "log_group": log_group,
                    "pattern_id": shape_id,
                    "occurrences": len(group),
                    "window_start": window_start.isoformat(),
                    "window_end": window_end.isoformat(),
                },
                source_created_at=datetime.fromtimestamp(first / 1000, tz=timezone.utc),
                source_updated_at=datetime.fromtimestamp(last / 1000, tz=timezone.utc),
            )
        )

    logger.info(
        "aws_logs: %d events collapsed into %d patterns (%s)",
        len(events), len(documents), log_group,
    )
    return SourceRun(documents=documents, cursor={"end_ms": end_ms})
