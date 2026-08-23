"""What a resolved incident looks like once it becomes knowledge."""

from datetime import datetime, timedelta, timezone

from app.agents.knowledge import build_content


def _incident(**overrides):
    created = datetime(2026, 8, 18, 10, 0, tzinfo=timezone.utc)
    base = {
        "title": "Pool exhausted on payments-db",
        "description": "240 of 240 slots busy for 41 minutes.",
        "resolution_summary": "Raised the ceiling to 400 in two steps.",
        "service_name": "payments-api",
        "environment": "Production",
        "category": "Database",
        "priority": "P1",
        "created_at": created,
        "resolved_at": created + timedelta(minutes=18),
    }
    base.update(overrides)
    return base


def test_carries_both_the_symptom_and_the_resolution():
    # Matching happens on the symptom; the resolution is why the match is worth
    # retrieving. A document with only one of them is half useless.
    content = build_content(_incident())
    assert "240 of 240 slots busy" in content
    assert "Raised the ceiling to 400" in content


def test_records_time_to_resolution_when_both_timestamps_exist():
    assert "Time to resolution: 18 minutes" in build_content(_incident())


def test_omits_the_duration_rather_than_guessing_it():
    assert "Time to resolution" not in build_content(_incident(resolved_at=None))


def test_missing_prose_is_marked_not_invented():
    content = build_content(_incident(description=None, resolution_summary=None))
    assert content.count("(not recorded)") == 2
