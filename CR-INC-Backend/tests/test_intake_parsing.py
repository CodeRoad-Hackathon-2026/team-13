"""How an inbound payload becomes an incident.

Intake is the widest input surface in the system — anything can post to it — so
its normalisation is where a typo becomes a filter chip nobody can select.
"""

import pytest

from app.agents.intake import derive_title, normalise_environment, normalise_source


class TestDeriveTitle:
    def test_prefers_an_explicit_title(self):
        assert derive_title({"title": "Pool exhausted", "body": "something else"}) == "Pool exhausted"

    def test_falls_back_to_subject_then_summary(self):
        assert derive_title({"subject": "Checkout 5xx"}) == "Checkout 5xx"
        assert derive_title({"summary": "Latency up"}) == "Latency up"

    def test_takes_the_first_sentence_of_a_body(self):
        payload = {"body": "Pool saturated at 99%. Checkout latency tripled. Paging now."}
        assert derive_title(payload) == "Pool saturated at 99%."

    def test_takes_the_first_line_when_there_is_no_sentence_end(self):
        assert derive_title({"body": "Pool saturated\nmore detail here"}) == "Pool saturated"

    def test_an_empty_payload_still_yields_a_title(self):
        # The column is NOT NULL; a nameless incident must still be openable.
        assert derive_title({}) == "Untitled incident"
        assert derive_title({"title": "   ", "body": ""}) == "Untitled incident"

    def test_truncates_to_the_column_width(self):
        assert len(derive_title({"title": "x" * 500})) == 160


class TestNormaliseSource:
    @pytest.mark.parametrize(
        "raw,expected",
        [("email", "Email"), ("PagerDuty", "PagerDuty"), ("  slack ", "Slack"), ("api", "API")],
    )
    def test_maps_to_the_vocabulary_the_dashboard_filters_on(self, raw, expected):
        assert normalise_source(raw) == expected

    def test_unknown_and_missing_sources_become_manual(self):
        # The UI's source filter is a closed set; an unmapped value would render
        # as a chip that filters to nothing.
        assert normalise_source("carrier-pigeon") == "Manual"
        assert normalise_source(None) == "Manual"


class TestNormaliseEnvironment:
    @pytest.mark.parametrize(
        "raw,expected",
        [("prod", "Production"), ("PRODUCTION", "Production"), ("dev", "Development"), ("staging", "Staging")],
    )
    def test_maps_common_spellings(self, raw, expected):
        assert normalise_environment(raw) == expected

    def test_defaults_to_production(self):
        # Pessimistic on purpose: an unlabelled incident treated as production
        # gets seen. Treated as development, it sits outside the default view.
        assert normalise_environment(None) == "Production"
        assert normalise_environment("somewhere-else") == "Production"
