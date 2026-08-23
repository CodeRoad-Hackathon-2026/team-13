"""The shared reply parsing both decision-making agents depend on."""

from app.agents.parsing import extract_json_object, one_of


class TestExtractJsonObject:
    def test_reads_a_fenced_block(self):
        assert extract_json_object('```json\n{"a": 1}\n```') == {"a": 1}

    def test_reads_an_object_buried_in_prose(self):
        assert extract_json_object('Given runbook #42: {"a": 1} — apply it.') == {"a": 1}

    def test_prose_alone_is_a_decline(self):
        assert extract_json_object("The sources do not support an action.") is None

    def test_malformed_json_is_not_repaired(self):
        assert extract_json_object('{"a": 1,}') is None

    def test_an_array_is_not_an_object(self):
        assert extract_json_object("[1, 2]") is None


class TestOneOf:
    def test_accepts_a_known_value_case_insensitively(self):
        assert one_of("p1", {"P1", "P2"}, "P3") == "P1"

    def test_falls_back_on_a_hallucinated_value(self):
        # Every enum column rejects unknowns at insert time, so an unconstrained
        # value would abort the write rather than degrade.
        assert one_of("P0", {"P1", "P2"}, "P3") == "P3"
        assert one_of(None, {"P1"}, "P3") == "P3"
