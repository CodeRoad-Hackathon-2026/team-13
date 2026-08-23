"""The roster's honesty, and the shape of what it accepts.

The database-backed paths are exercised against a real Postgres in the
verification script; what is worth pinning here is the part that can drift
silently: a map in Python describing agents that live in SQL.
"""

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.api.agents import INVOCATION, GuardrailsUpdate

SEEDS = Path(__file__).resolve().parents[1] / "db" / "seeds" / "001_agents.sql"


def seeded_agent_names() -> set[str]:
    """The agent names in the seed file, read rather than restated.

    A second hand-maintained list would be the thing that drifts.
    """
    sql = SEEDS.read_text()
    # Each row starts with the quoted agent name.
    return set(re.findall(r"^\s*\('([^']+)',", sql, re.MULTILINE))


class TestInvocationMapMatchesTheSeeds:
    def test_the_seed_file_is_readable_and_not_empty(self):
        # If this fails the two tests below are vacuously true, which is worse
        # than either of them failing.
        assert len(seeded_agent_names()) >= 8

    def test_every_seeded_agent_has_an_entry(self):
        missing = seeded_agent_names() - set(INVOCATION)

        assert not missing, (
            f"{missing} are seeded but not described. The roster falls back to "
            "'unknown', which reads as a bug rather than as a fact about the code."
        )

    def test_no_entry_describes_an_agent_that_is_not_seeded(self):
        extra = set(INVOCATION) - seeded_agent_names()

        assert not extra, f"{extra} are described but no longer seeded"

    def test_validation_agent_is_recorded_as_having_no_module(self):
        # Eight rows, seven classes. The roster exists partly to say this out
        # loud — it is why the funnel's last stage reads as unavailable.
        assert INVOCATION["Validation Agent"]["hasModule"] is False
        assert INVOCATION["Validation Agent"]["invokedBy"] == "nothing"

    def test_knowledge_generation_is_recorded_as_uncalled(self):
        entry = INVOCATION["Knowledge Generation Agent"]

        assert entry["hasModule"] is True
        assert entry["invokedBy"] == "nothing"

    def test_only_the_decision_agent_is_described_as_proposing(self):
        proposers = [
            name for name, e in INVOCATION.items() if "propose" in e["detail"].lower()
        ]

        assert proposers == ["Decision Agent"]

    @pytest.mark.parametrize("name", sorted(INVOCATION))
    def test_every_entry_says_what_invokes_it(self, name):
        entry = INVOCATION[name]

        assert entry["invokedBy"] in {"ingest", "pipeline", "approval", "nothing"}
        assert entry["detail"].strip()


class TestGuardrailsUpdate:
    def test_a_whole_window_is_accepted(self):
        payload = GuardrailsUpdate(
            blackoutStartDow=5, blackoutStartTime="16:00",
            blackoutEndDow=1, blackoutEndTime="06:00",
        )

        assert payload.blackoutStartDow == 5

    def test_two_of_four_fields_is_refused(self):
        # A window whose meaning depends on which two were sent.
        with pytest.raises(ValidationError) as caught:
            GuardrailsUpdate(blackoutStartDow=5, blackoutStartTime="16:00")

        assert "all four" in str(caught.value)

    def test_clearing_and_setting_at_once_is_refused(self):
        with pytest.raises(ValidationError):
            GuardrailsUpdate(
                clearBlackout=True,
                blackoutStartDow=5, blackoutStartTime="16:00",
                blackoutEndDow=1, blackoutEndTime="06:00",
            )

    def test_touching_only_the_ceiling_leaves_the_window_alone(self):
        payload = GuardrailsUpdate(maxConcurrentExecutions=4)

        assert payload.clearBlackout is False
        assert payload.blackoutStartDow is None

    def test_a_ceiling_of_zero_is_refused(self):
        # The schema also forbids it; a 422 naming the field beats a constraint
        # violation rendered as a 500.
        with pytest.raises(ValidationError):
            GuardrailsUpdate(maxConcurrentExecutions=0)

    @pytest.mark.parametrize("dow", [0, 8])
    def test_a_day_outside_the_week_is_refused(self, dow):
        with pytest.raises(ValidationError):
            GuardrailsUpdate(
                blackoutStartDow=dow, blackoutStartTime="16:00",
                blackoutEndDow=1, blackoutEndTime="06:00",
            )


class TestSkillFields:
    """Validation shared by create and edit.

    The one worth reading twice is the serviceId sentinel: an omitted field and an
    explicit null are different intentions, and if they collapse then renaming a
    skill silently unbinds it from its service.
    """

    def test_an_omitted_service_is_not_the_same_as_a_null_one(self):
        from app.api.agents import UNSET, SkillUpdate

        assert SkillUpdate().serviceId is UNSET
        assert SkillUpdate(serviceId=None).serviceId is None

    def test_action_type_is_upper_cased_so_the_registry_lookup_matches(self):
        from app.api.agents import SkillUpdate

        assert SkillUpdate(actionType="github_pr").actionType == "GITHUB_PR"

    def test_a_blank_action_type_is_refused(self):
        from app.api.agents import SkillUpdate

        with pytest.raises(ValidationError):
            SkillUpdate(actionType="   ")

    def test_a_type_with_no_executor_is_accepted(self):
        # Deliberate: the skill may be registered just before its executor, and
        # preflight repeats the fact on the approval card either way.
        from app.api.agents import SkillUpdate

        assert SkillUpdate(actionType="SQL").actionType == "SQL"

    def test_risk_level_is_normalised_and_checked(self):
        from app.api.agents import SkillUpdate

        assert SkillUpdate(riskLevel="high").riskLevel == "HIGH"
        with pytest.raises(ValidationError):
            SkillUpdate(riskLevel="CATASTROPHIC")

    def test_an_environment_no_incident_can_carry_is_refused(self):
        # "Prod" normalises to "Production" on the way in, so a skill scoped to
        # the literal "Prod" could never match an incident.
        from app.api.agents import SkillUpdate

        with pytest.raises(ValidationError) as caught:
            SkillUpdate(environments=["Prod"])

        assert "unknown environment" in str(caught.value)

    def test_the_valid_environments_come_from_the_intake_map(self):
        # Not a second hand-maintained list: intake decides what an incident's
        # environment can be, so it decides what a skill can be scoped to.
        from app.agents.intake import ENVIRONMENTS
        from app.api.agents import VALID_ENVIRONMENTS

        assert set(VALID_ENVIRONMENTS) == set(ENVIRONMENTS.values())

    def test_create_demands_a_name_and_an_action_type(self):
        from app.api.agents import SkillCreate

        with pytest.raises(ValidationError):
            SkillCreate(name="No type")
        with pytest.raises(ValidationError):
            SkillCreate(actionType="API")
        assert SkillCreate(name="Fine", actionType="API").name == "Fine"


class TestActionTypeVocabulary:
    def test_every_executable_type_is_in_the_vocabulary(self):
        # A tool registered under a name the planner is never told about could
        # never be reached.
        from app.agents.preflight import DELIVERY_TYPE
        from app.api.agents import ACTION_TYPE_VOCABULARY
        from app.tools import registry

        for name in list(registry()) + [DELIVERY_TYPE]:
            assert name in ACTION_TYPE_VOCABULARY

    def test_the_vocabulary_still_contains_types_with_no_executor(self):
        # If this ever fails, either an executor was added — good, delete this
        # test — or the vocabulary was quietly trimmed and preflight's whole
        # "no executor is registered" branch became unreachable.
        from app.api.agents import ACTION_TYPE_VOCABULARY
        from app.agents.preflight import DELIVERY_TYPE
        from app.tools import registry

        executable = set(registry()) | {DELIVERY_TYPE}
        assert set(ACTION_TYPE_VOCABULARY) - executable
