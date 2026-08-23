"""Who decides whether a human sees an agent's work.

The rules have a precedence and the precedence is the design, so most of these
assert ordering rather than outcomes: that never-touch beats a permissive policy,
that a guardrail defers a decision instead of dropping the work, and that the one
level which removes the human cannot be selected without a server-side opt-in.
"""

from datetime import datetime, time

import pytest

from app.agents.policy import decide, in_blackout_window
from app.config import settings

GUARDED = ("agent_autonomy_enabled",)


@pytest.fixture(autouse=True)
def restore_settings():
    saved = {name: getattr(settings, name) for name in GUARDED}
    yield
    for name, value in saved.items():
        setattr(settings, name, value)


OPEN_GUARDRAILS = {
    "max_concurrent_executions": 2,
    "blackout_start_dow": None,
    "blackout_start_time": None,
    "blackout_end_dow": None,
    "blackout_end_time": None,
    "never_touch_services": [],
}

# A Wednesday at 10:00, deliberately outside any weekend window below.
MIDWEEK = datetime(2026, 8, 19, 10, 0)


def run(
    *,
    action_type="API",
    risk_level="LOW",
    autonomy="act_with_approval",
    risk_policy=None,
    skills=None,
    guardrails=None,
    service_name="payments-api",
    running_executions=0,
    now=MIDWEEK,
):
    return decide(
        action_type=action_type,
        risk_level=risk_level,
        autonomy=autonomy,
        risk_policy=risk_policy or {"LOW": "auto_run", "MEDIUM": "ask_first", "HIGH": "ask_first"},
        skills=skills or [],
        guardrails={**OPEN_GUARDRAILS, **(guardrails or {})},
        service_name=service_name,
        running_executions=running_executions,
        now=now,
    )


class TestSuppression:
    def test_never_touch_beats_the_most_permissive_policy_there_is(self):
        settings.agent_autonomy_enabled = True
        result = run(
            autonomy="act_autonomously",
            risk_policy={"LOW": "auto_run", "MEDIUM": "auto_run", "HIGH": "auto_run"},
            guardrails={"never_touch_services": ["billing-core", "payments-api"]},
        )

        assert result["disposition"] == "suppressed"
        assert result["rule"] == "never_touch"

    def test_never_touch_is_case_insensitive_because_an_operator_typed_it(self):
        result = run(
            service_name="Payments-API",
            guardrails={"never_touch_services": ["payments-api"]},
        )

        assert result["rule"] == "never_touch"

    def test_a_disabled_skill_suppresses_its_own_action_type(self):
        result = run(
            action_type="API",
            skills=[{"name": "Purge CDN cache", "action_type": "API", "enabled": False}],
        )

        assert result["disposition"] == "suppressed"
        assert "Purge CDN cache" in result["reason"]

    def test_a_disabled_skill_for_another_action_type_does_not_interfere(self):
        result = run(
            action_type="API",
            skills=[{"name": "Open a PR", "action_type": "GITHUB_PR", "enabled": False}],
        )

        assert result["disposition"] == "auto_run"

    def test_observe_proposes_nothing(self):
        result = run(autonomy="observe", risk_policy={"LOW": "auto_run"})

        assert result["disposition"] == "suppressed"
        assert result["rule"] == "autonomy_observe"

    def test_never_for_a_risk_level_proposes_nothing(self):
        result = run(risk_level="HIGH", risk_policy={"HIGH": "never"})

        assert result["disposition"] == "suppressed"
        assert result["rule"] == "risk_never"


class TestSkillSpecificity:
    def test_a_skill_bound_to_the_service_wins_over_an_unbound_one(self):
        # Otherwise disabling a skill for one service would be undone by a
        # broader skill of the same action type, silently.
        result = run(
            action_type="API",
            service_name="checkout-web",
            skills=[
                {"name": "Any HTTP call", "action_type": "API", "enabled": True},
                {
                    "name": "Purge CDN cache",
                    "action_type": "API",
                    "service_name": "checkout-web",
                    "enabled": False,
                },
            ],
        )

        assert result["rule"] == "skill_disabled"

    def test_a_skill_bound_to_a_different_service_is_not_consulted(self):
        result = run(
            action_type="API",
            service_name="payments-api",
            skills=[
                {
                    "name": "Purge CDN cache",
                    "action_type": "API",
                    "service_name": "checkout-web",
                    "enabled": False,
                }
            ],
        )

        assert result["disposition"] == "auto_run"


class TestWhoDecides:
    def test_suggest_overrides_a_permissive_risk_policy(self):
        result = run(autonomy="suggest", risk_policy={"LOW": "auto_run"})

        assert result["disposition"] == "ask_first"
        assert result["rule"] == "autonomy_suggest"

    def test_ask_first_for_this_risk_level(self):
        result = run(risk_level="HIGH")

        assert result["disposition"] == "ask_first"
        assert result["rule"] == "risk_ask_first"

    def test_auto_run_for_this_risk_level(self):
        result = run(risk_level="LOW")

        assert result["disposition"] == "auto_run"
        assert result["rule"] == "risk_auto_run"

    def test_an_unknown_risk_level_asks_rather_than_runs(self):
        # decision.py already defaults an unparseable risk to MEDIUM, but a
        # policy dict missing a level must not fail open.
        result = run(risk_level="CATASTROPHIC", risk_policy={"LOW": "auto_run"})

        assert result["disposition"] == "ask_first"


class TestAutonomousNeedsAServerOptIn:
    def test_refused_while_the_setting_is_off(self):
        settings.agent_autonomy_enabled = False
        result = run(autonomy="act_autonomously", risk_policy={"HIGH": "ask_first"}, risk_level="HIGH")

        assert result["disposition"] == "ask_first"
        assert result["rule"] == "autonomy_not_enabled"
        assert "AGENT_AUTONOMY_ENABLED" in result["reason"]

    def test_honoured_once_it_is_on(self):
        settings.agent_autonomy_enabled = True
        result = run(autonomy="act_autonomously", risk_policy={"HIGH": "ask_first"}, risk_level="HIGH")

        assert result["disposition"] == "auto_run"
        assert result["rule"] == "autonomy_autonomous"

    def test_the_setting_does_not_gate_an_ordinary_auto_run_policy(self):
        # It gates the level that removes the human from everything, not an
        # operator's per-risk choice.
        settings.agent_autonomy_enabled = False
        result = run(autonomy="act_with_approval", risk_level="LOW")

        assert result["disposition"] == "auto_run"


class TestGuardrailsDowngrade:
    # These defer a decision; they never drop the work. The incident is real
    # whether or not it is Saturday.
    def test_the_blackout_window_asks_instead_of_running(self):
        result = run(
            risk_level="LOW",
            guardrails={
                "blackout_start_dow": 5,
                "blackout_start_time": time(16, 0),
                "blackout_end_dow": 1,
                "blackout_end_time": time(6, 0),
            },
            now=datetime(2026, 8, 22, 3, 0),  # a Saturday
        )

        assert result["disposition"] == "ask_first"
        assert result["rule"] == "blackout_window"

    def test_outside_the_window_it_still_runs(self):
        result = run(
            risk_level="LOW",
            guardrails={
                "blackout_start_dow": 5,
                "blackout_start_time": time(16, 0),
                "blackout_end_dow": 1,
                "blackout_end_time": time(6, 0),
            },
            now=MIDWEEK,
        )

        assert result["disposition"] == "auto_run"

    def test_the_concurrency_ceiling_asks_instead_of_running(self):
        result = run(risk_level="LOW", running_executions=2, guardrails={"max_concurrent_executions": 2})

        assert result["disposition"] == "ask_first"
        assert result["rule"] == "at_concurrency_ceiling"
        assert "2 of 2" in result["reason"]

    def test_below_the_ceiling_it_runs(self):
        result = run(risk_level="LOW", running_executions=1, guardrails={"max_concurrent_executions": 2})

        assert result["disposition"] == "auto_run"

    def test_a_guardrail_never_turns_into_suppression(self):
        # The failure mode worth guarding: a busy Saturday silently dropping
        # every proposal, which reads exactly like an agent that found nothing.
        result = run(
            risk_level="LOW",
            running_executions=99,
            guardrails={
                "max_concurrent_executions": 1,
                "blackout_start_dow": 1,
                "blackout_start_time": time(0, 0),
                "blackout_end_dow": 7,
                "blackout_end_time": time(23, 59),
            },
        )

        assert result["disposition"] == "ask_first"


class TestBlackoutWindow:
    WINDOW = (5, time(16, 0), 1, time(6, 0))  # Fri 16:00 → Mon 06:00

    @pytest.mark.parametrize(
        "moment,inside",
        [
            (datetime(2026, 8, 21, 15, 59), False),  # Friday, just before
            (datetime(2026, 8, 21, 16, 0), True),  # Friday, on the hour
            (datetime(2026, 8, 22, 12, 0), True),  # Saturday
            (datetime(2026, 8, 23, 23, 59), True),  # Sunday night
            (datetime(2026, 8, 24, 5, 59), True),  # Monday, just before the end
            (datetime(2026, 8, 24, 6, 0), False),  # Monday, on the hour
            (datetime(2026, 8, 19, 10, 0), False),  # Wednesday
        ],
    )
    def test_a_window_that_wraps_past_sunday(self, moment, inside):
        assert in_blackout_window(moment, *self.WINDOW) is inside

    def test_a_window_inside_one_day(self):
        # Tue 09:00 → Tue 17:00, the non-wrapping case.
        window = (2, time(9, 0), 2, time(17, 0))

        assert in_blackout_window(datetime(2026, 8, 18, 12, 0), *window) is True
        assert in_blackout_window(datetime(2026, 8, 18, 8, 0), *window) is False
        assert in_blackout_window(datetime(2026, 8, 19, 12, 0), *window) is False

    def test_no_window_configured_is_never_inside(self):
        assert in_blackout_window(MIDWEEK, None, None, None, None) is False

    def test_a_half_configured_window_is_ignored_rather_than_guessed(self):
        # The schema forbids this, but a NULL that reached here must not be read
        # as midnight.
        assert in_blackout_window(MIDWEEK, 5, time(16, 0), None, None) is False
