"""The dashboard's five aggregate endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import connection, parse_env, parse_service
from app.queries import dashboard as q

router = APIRouter(tags=["dashboard"])

CATEGORY_CAP = 6

FUNNEL_LABELS: list[tuple[str, str]] = [
    ("received", "Incidents received"),
    ("classified", "Classified by AI"),
    ("ragMatched", "RAG match found"),
    ("recommended", "Action recommended"),
    ("approvedOrAutoRun", "Approved / auto-run"),
    ("executedSuccessfully", "Executed successfully"),
    ("validatedResolved", "Validated + resolved"),
]


def _window(frm: str | None, to: str | None) -> tuple[datetime, datetime]:
    """Resolve the requested range, defaulting to the last 7 days."""
    end = datetime.fromisoformat(to) if to else datetime.now(timezone.utc)
    start = datetime.fromisoformat(frm) if frm else end - timedelta(days=7)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return start, end


def _pct(part: float, whole: float) -> int:
    return round(part * 100 / whole) if whole else 0


@router.get("/dashboard/alert-strip")
async def alert_strip(conn: asyncpg.Connection = Depends(connection)) -> dict[str, Any]:
    """Deliberately takes no parameters (FR-014) — always current state."""
    row = await conn.fetchrow(q.ALERT_STRIP)
    awaiting = row["awaiting_approval"] or 0
    return {
        "p1Active": row["p1_active"] or 0,
        "awaitingApproval": awaiting,
        # Null only when nothing is pending — the strip says "nothing blocked on
        # a human" rather than showing an age of zero.
        "oldestPendingAgeMinutes": (
            round(float(row["oldest_pending_minutes"])) if awaiting and row["oldest_pending_minutes"] else None
        ),
        "autoExecutedCountInRange": row["auto_executed"] or 0,
    }


@router.get("/dashboard/now")
async def now_tiles(
    env: list[str] | None = Depends(parse_env),
    service: str | None = Depends(parse_service),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    """No from/to: the Now tab is always current (FR-030)."""
    row = await conn.fetchrow(q.NOW_TILES, env, service)
    oldest = await conn.fetchrow(q.OLDEST_OPEN, env, service)

    return {
        "openIncidents": {
            "value": row["open_now"],
            "deltaVsPrevious": row["open_now"] - row["open_before"],
        },
        "escalated": {
            "value": row["escalated_now"],
            "deltaVsPrevious": row["escalated_now"] - row["escalated_before"],
        },
        "unassigned": {
            "value": row["unassigned_now"],
            "deltaVsPrevious": row["unassigned_now"] - row["unassigned_before"],
        },
        # Both null together when nothing is open — never a zero age.
        "oldestOpen": {
            "ageMinutes": round(float(oldest["age_minutes"])) if oldest else None,
            "priority": oldest["priority"] if oldest else None,
        },
        # p1Active and awaitingApproval are deliberately absent: they belong to
        # the alert strip alone (FR-027).
    }


@router.get("/dashboard/performance")
async def performance(
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    env: list[str] | None = Depends(parse_env),
    service: str | None = Depends(parse_service),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    start, end = _window(frm, to)
    span = end - start
    prev_start, prev_end = start - span, start

    tiles = await conn.fetchrow(q.PERFORMANCE_TILES, start, end, env, service)
    prev = await conn.fetchrow(q.PERFORMANCE_TILES, prev_start, prev_end, env, service)
    funnel = await conn.fetchrow(q.FUNNEL, start, end, env, service)
    outcomes = await conn.fetchrow(q.OUTCOMES, start, end, env, service)
    by_type = await conn.fetch(q.OUTCOMES_BY_ACTION_TYPE, start, end, env, service)
    failures = await conn.fetch(q.RECENT_FAILURES, start, end, env, service)

    automation_rate = _pct(tiles["fully_automated"] or 0, tiles["action_total"] or 0)
    prev_automation = _pct(prev["fully_automated"] or 0, prev["action_total"] or 0)
    known_rate = _pct(tiles["known_count"] or 0, tiles["incident_count"] or 0)
    prev_known = _pct(prev["known_count"] or 0, prev["incident_count"] or 0)

    median = tiles["median_minutes"]
    prev_median = prev["median_minutes"]

    counts = {
        "success": outcomes["success"] or 0,
        "failed": outcomes["failed"] or 0,
        "rolledBack": outcomes["rolled_back"] or 0,
        "running": outcomes["running"] or 0,
    }
    settled = counts["success"] + counts["failed"] + counts["rolledBack"]

    stage_counts = {
        "received": funnel["received"],
        "classified": funnel["classified"],
        "ragMatched": funnel["rag_matched"],
        "recommended": funnel["recommended"],
        "approvedOrAutoRun": funnel["approved_or_auto"],
        "executedSuccessfully": funnel["executed_ok"],
        # No validation record exists anywhere yet. Null, never a fabricated 0 —
        # the UI already renders "Not yet available" for exactly this.
        "validatedResolved": None,
    }

    stages = []
    previous_count: int | None = None
    for key, label in FUNNEL_LABELS:
        count = stage_counts[key]
        drop = None if (previous_count is None or count is None) else previous_count - count
        stages.append({"key": key, "label": label, "count": count, "dropCount": drop})
        if count is not None:
            previous_count = count

    return {
        "tiles": {
            "automationRatePercent": {
                "value": automation_rate,
                "deltaVsPrevious": automation_rate - prev_automation,
            },
            "medianTimeToResolveMinutes": {
                "value": round(float(median)) if median is not None else None,
                "averageMinutes": round(float(tiles["average_minutes"] or 0)),
                "deltaVsPrevious": (
                    round(float(median) - float(prev_median))
                    if median is not None and prev_median is not None
                    else None
                ),
            },
            "knownIncidentHitRate": {
                "value": known_rate,
                "deltaVsPrevious": known_rate - prev_known,
            },
        },
        "funnel": {
            "stages": stages,
            "automationRate": {
                "fullyAutomatedPercent": automation_rate,
                "humanAssistedPercent": _pct(
                    tiles["human_assisted"] or 0, tiles["action_total"] or 0
                ),
            },
        },
        "outcomes": {
            "counts": counts,
            "successRatePercent": _pct(counts["success"], settled),
            "medianDurationMinutes": (
                round(float(outcomes["median_minutes"]))
                if outcomes["median_minutes"] is not None
                else None
            ),
            "byActionType": [
                {
                    "actionType": r["action_type"],
                    "success": r["success"],
                    "failed": r["failed"],
                    "rolledBack": r["rolled_back"],
                    "running": r["running"],
                    # None while every run of this type is still in flight — the panel says so
                    # rather than printing a zero it would have had to invent.
                    "medianDurationMinutes": (
                        round(float(r["median_minutes"])) if r["median_minutes"] is not None else None
                    ),
                }
                for r in by_type
            ],
            "recentFailures": [
                {
                    "executedActionId": str(r["executed_action_id"]),
                    "incidentId": str(r["incident_id"]),
                    "actionType": r["action_type"],
                    "truncatedErrorMessage": (
                        r["message"] + "…" if r["full_length"] > 80 else r["message"]
                    ),
                }
                for r in failures
            ],
        },
    }


@router.get("/dashboard/breakdowns")
async def breakdowns(
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    env: list[str] | None = Depends(parse_env),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    start, end = _window(frm, to)

    volume = await conn.fetch(q.VOLUME, start, end, env)
    by_priority = await conn.fetch(q.BY_PRIORITY, start, end, env)
    by_category = await conn.fetch(q.BY_CATEGORY, start, end, env)
    by_service = await conn.fetch(q.BY_SERVICE, start, end, env)

    # Top 6 plus a single "Other" bucket: a long tail of one-off categories
    # makes the chart unreadable and tells the operator nothing.
    head = by_category[:CATEGORY_CAP]
    tail = sum(r["count"] for r in by_category[CATEGORY_CAP:])
    categories = [{"category": r["category"], "count": r["count"]} for r in head]
    if tail:
        categories.append({"category": "Other", "count": tail})

    return {
        "volume": [
            {
                "bucketStart": r["bucket_start"].isoformat(),
                "known": r["known"],
                "unknown": r["unknown"],
                "medianResolutionMinutes": (
                    round(float(r["median_minutes"])) if r["median_minutes"] is not None else None
                ),
            }
            for r in volume
        ],
        "byPriority": [{"priority": r["priority"], "count": r["count"]} for r in by_priority],
        "byCategory": categories,
        "byService": [
            {
                "serviceId": str(r["service_id"]),
                "serviceName": r["service_name"],
                "count": r["count"],
                "knownRate": round(float(r["known_rate"]), 4),
            }
            for r in by_service
        ],
    }


@router.get("/dashboard/knowledge")
async def knowledge(
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    """Takes only from/to — the frontend sends no env or service here."""
    start, end = _window(frm, to)

    tiles = await conn.fetchrow(q.KNOWLEDGE_TILES, start, end)
    gaps = await conn.fetch(q.COVERAGE_GAPS, start, end)
    documents = await conn.fetch(q.DOCUMENTS_DRIVING_RESOLUTIONS, start, end)

    return {
        "tiles": {
            "knowledgeDocumentCount": tiles["document_count"],
            "distinctDocumentTypeCount": tiles["document_type_count"],
            "servicesWithRunbookCount": tiles["services_with_runbook"],
            "totalServiceCount": tiles["total_services"],
            "undocumentedResolutionCount": tiles["undocumented_resolutions"],
        },
        "coverageGaps": [
            {
                "serviceId": str(r["service_id"]),
                "serviceName": r["service_name"],
                "knownRate": round(float(r["known_rate"]), 4),
            }
            for r in gaps
        ],
        "documentsDrivingResolutions": [
            {
                "documentId": str(r["document_id"]),
                "documentType": r["document_type"],
                "title": r["title"],
                "resolutionCount": r["resolution_count"],
            }
            for r in documents
        ],
    }
