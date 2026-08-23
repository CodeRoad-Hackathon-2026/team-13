from app.agents.retrieval import build_query


class FakeIncident(dict):
    """asyncpg.Record is mapping-like; a dict is enough for query building."""


def test_uses_title_and_description():
    incident = FakeIncident(title="Pool exhausted", description="240 of 240 slots busy")
    assert build_query(incident) == "Pool exhausted\n\n240 of 240 slots busy"


def test_title_alone_when_there_is_no_description():
    assert build_query(FakeIncident(title="Pool exhausted", description=None)) == "Pool exhausted"


def test_blank_description_does_not_leave_trailing_separator():
    assert build_query(FakeIncident(title="Pool exhausted", description="   ")) == "Pool exhausted"


class TestSimilarityOf:
    def test_prefers_the_reranker_score(self):
        from app.agents.retrieval import similarity_of

        hit = {"score": 0.032, "scores": {"rerank": 0.91, "vector": 0.55}}
        assert similarity_of(hit) == 0.91

    def test_falls_back_to_cosine_when_reranking_is_off(self):
        from app.agents.retrieval import similarity_of

        # rerank is null whenever RERANK_ENABLED is false, which is the default.
        hit = {"score": 0.032, "scores": {"rerank": None, "vector": 0.5639}}
        assert similarity_of(hit) == 0.5639

    def test_never_treats_the_rrf_rank_as_a_similarity(self):
        from app.agents.retrieval import similarity_of

        # RRF sits near 0.03 however close the match is. Reading it as a
        # similarity leaves every threshold unreachable and is_known_incident
        # permanently false.
        hit = {"score": 0.032522, "scores": {"rerank": None, "vector": 0.49}}
        assert similarity_of(hit) > 0.4

    def test_uses_the_fused_score_only_when_nothing_else_is_reported(self):
        from app.agents.retrieval import similarity_of

        assert similarity_of({"score": 0.42, "scores": {}}) == 0.42
        assert similarity_of({"score": 0.42}) == 0.42
