"""Developer feedback: submission, and the impact widget's figures."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel, Field

from app.api.deps import connection, not_found
from app.queries import incidents as q

router = APIRouter(tags=["feedback"])

# FI-4: below this many team-wide corrections the widget renders nothing at all,
# rather than a number with a caveat attached.
SUPPRESSION_FLOOR = 10


class FeedbackRequest(BaseModel):
    actor: str = Field(min_length=1)
    feedbackType: str
    comments: str = ""
    correctedCategory: str | None = None
    correctedPriority: str | None = None
    correctedResolution: str | None = None


@router.post("/incidents/{incident_id}/feedback", status_code=201)
async def submit_feedback(
    incident_id: str,
    payload: FeedbackRequest = Body(...),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    exists = await conn.fetchval("SELECT 1 FROM incidents WHERE id = $1", incident_id)
    if not exists:
        raise not_found("That incident could not be found.")

    row = await conn.fetchrow(
        q.INSERT_FEEDBACK,
        incident_id,
        payload.feedbackType,
        payload.comments,
        payload.correctedCategory,
        payload.correctedPriority,
        payload.correctedResolution,
        payload.actor,
    )
    # Returned in exactly the drawer's feedback[] element shape: the client
    # prepends this row to its local list rather than refetching the drawer.
    return {
        "id": str(row["id"]),
        "feedbackType": row["feedback_type"],
        "comments": row["comments"],
        "correctedCategory": row["corrected_category"],
        "correctedPriority": row["corrected_priority"],
        "correctedResolution": row["corrected_resolution"],
        "createdBy": row["created_by"],
        "createdAt": row["created_at"].isoformat(),
    }


@router.get("/feedback/impact")
async def feedback_impact(
    user: str | None = Query(default=None),
    conn: asyncpg.Connection = Depends(connection),
) -> dict[str, Any]:
    """Personal figures are all-time; team figures are the current quarter.

    Any from/to a caller sends is ignored rather than applied — the widget's
    numbers are defined over those two fixed windows, and silently honouring a
    range would make the same screen mean different things to different people.
    """
    if not user:
        return _suppressed()

    row = await conn.fetchrow(q.FEEDBACK_IMPACT, user)
    team_count = row["team_count"] or 0
    if team_count < SUPPRESSION_FLOOR:
        return _suppressed()

    # Accuracy is the share of incidents the classifier got right, which is what
    # corrections move. Previous is the same figure before this user's latest
    # corrections landed — approximated by excluding them from the numerator.
    total = row["total_incidents"] or 0
    known = row["known_incidents"] or 0
    accuracy = round(known * 100 / total) if total else 0
    personal = row["personal_count"] or 0
    previous = round(max(0, known - personal) * 100 / total) if total else 0

    today = datetime.now(timezone.utc)
    quarter_label = f"Q{(today.month - 1) // 3 + 1} {today.year}"

    return {
        "personal": {
            "accuracyPercent": accuracy,
            "previousAccuracyPercent": previous,
            "correctionCount": personal,
            "lastCorrectionAt": (
                row["last_correction"].isoformat() if row["last_correction"] else None
            ),
        },
        "team": {
            "correctionCount": team_count,
            "engineerCount": row["engineer_count"] or 0,
            "quarterLabel": quarter_label,
        },
        "suppressed": False,
        # No declineReason field, deliberately: FI-3 forbids attributing a
        # decline to the viewing user.
    }


def _suppressed() -> dict[str, Any]:
    return {
        "personal": {
            "accuracyPercent": 0,
            "previousAccuracyPercent": 0,
            "correctionCount": 0,
            "lastCorrectionAt": None,
        },
        "team": {"correctionCount": 0, "engineerCount": 0, "quarterLabel": ""},
        "suppressed": True,
    }
