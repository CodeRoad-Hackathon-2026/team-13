"""The Decision Agent's reply parsing and score handling.

These are the two places a model's output turns into a database row, so they
are the two places a wrong guess becomes a fabricated remediation.
"""

from decimal import Decimal

import pytest

from app.agents.base import to_numeric
from app.agents.decision import _total, parse_action


class TestParseAction:
    def test_reads_a_fenced_json_block(self):
        answer = """Here is the plan:
```json
{"action_type": "LAMBDA", "description": "restart the pool", "risk_level": "HIGH"}
```
That should do it."""
        assert parse_action(answer) == {
            "action_type": "LAMBDA",
            "description": "restart the pool",
            "risk_level": "HIGH",
        }

    def test_reads_a_bare_object_surrounded_by_prose(self):
        answer = 'Based on runbook #42: {"action_type": "SQL", "parameters": {"limit": 10}} — apply it.'
        assert parse_action(answer) == {"action_type": "SQL", "parameters": {"limit": 10}}

    def test_prose_with_no_object_is_a_decline_not_a_crash(self):
        # The documented way for the planner to say "the sources do not support
        # a specific action" — must read as None, never as an empty action.
        assert parse_action("The retrieved runbooks do not cover this failure mode.") is None

    def test_malformed_json_is_not_guessed_at(self):
        assert parse_action('{"action_type": "SQL",}') is None

    def test_a_json_array_is_not_an_action(self):
        assert parse_action('["LAMBDA", "SQL"]') is None

    def test_empty_answer(self):
        assert parse_action("") is None


class TestToNumeric:
    def test_clamps_a_reranker_score_above_one(self):
        # Every score column carries CHECK (0..1); an unclamped rerank score
        # would abort the insert rather than store a slightly-too-high number.
        assert to_numeric(1.42, 4) == Decimal("1.0")

    def test_clamps_below_zero(self):
        assert to_numeric(-0.3, 4) == Decimal("0.0")

    def test_quantises_to_the_column_scale(self):
        assert to_numeric(0.123456, 4) == Decimal("0.1235")
        assert to_numeric(0.123456, 5) == Decimal("0.12346")

    def test_none_stays_none(self):
        assert to_numeric(None, 4) is None

    @pytest.mark.parametrize("value", [0.0, 1.0, 0.5])
    def test_values_in_range_survive(self, value):
        assert float(to_numeric(value, 4)) == value


class TestTokenTotals:
    def test_sums_across_generation_and_judge(self):
        # RAG Core bills generation and the groundedness judge as separate calls,
        # so usage is nested per call rather than a single pair of totals.
        usage = {"generation": {"input": 900, "output": 120}, "judge": {"input": 300, "output": 20}}
        assert _total(usage, "input") == 1200
        assert _total(usage, "output") == 140

    def test_absent_usage_is_none_not_zero(self):
        # Zero would claim the call was free; None says it was not reported.
        assert _total({}, "input") is None
        assert _total({"generation": {}}, "input") is None


class TestFit:
    def test_trims_to_the_column_width(self):
        from app.agents.base import MODEL_WIDTH, PROMPT_VERSION_WIDTH, fit

        # RAG Core returns prompt versions longer than agent_runs.prompt_version
        # accepts. Untrimmed, the UPDATE that closes the run aborts — and because
        # that unwinds the caller's transaction, the RUNNING row goes with it and
        # the step leaves no trace at all.
        assert len(fit("v" * 200, PROMPT_VERSION_WIDTH)) == 50
        assert len(fit("m" * 200, MODEL_WIDTH)) == 100

    def test_leaves_short_values_alone(self):
        from app.agents.base import fit

        assert fit("claude-opus-5", 100) == "claude-opus-5"

    def test_none_stays_none(self):
        from app.agents.base import fit

        assert fit(None, 50) is None


class TestPromptVersion:
    def test_reads_the_version_id_out_of_the_entry(self):
        from app.agents.decision import _first_prompt_version

        # RAG Core reports an object per prompt, not a string. Stringifying the
        # whole entry stores a truncated dict where a version id belongs.
        versions = {"answer": {"version_id": "93bfba22-3263-4881-b578-cfd6c18d5b0a", "key": "answer"}}
        assert _first_prompt_version(versions) == "93bfba22-3263-4881-b578-cfd6c18d5b0a"

    def test_accepts_a_plain_string_entry(self):
        from app.agents.decision import _first_prompt_version

        assert _first_prompt_version({"answer": "v3"}) == "v3"

    def test_absent_or_unrecognised_is_none(self):
        from app.agents.decision import _first_prompt_version

        assert _first_prompt_version({}) is None
        assert _first_prompt_version(None) is None
        assert _first_prompt_version({"answer": {"unexpected": "shape"}}) is None
