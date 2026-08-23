"""Chunking and citation-validation tests — no database or network required."""

from __future__ import annotations

from app.ingestion.chunking import chunk_markdown, chunk_text
from app.rag.answer import extract_citations, strip_invalid_citations
from app.retrieval.hybrid import Candidate

RUNBOOK = """# Payments runbook

## Symptom
Checkout requests fail with ERR_UPSTREAM_TIMEOUT.

## Mitigation
Scale pgbouncer before scaling the API.

### Do not
Never restart the primary database during checkout traffic.
"""


def test_chunks_carry_their_heading_path():
    chunks = chunk_markdown(RUNBOOK)
    assert chunks, "expected at least one chunk"
    # A chunk about "scale pgbouncer" is useless without knowing which runbook
    # it came from, so the heading path is embedded in the text.
    assert all(c.context in c.content or not c.context for c in chunks)
    assert all(c.metadata["heading_path"] for c in chunks)


def test_merged_sections_are_not_misattributed():
    """Small sections merge, but must not inherit the first section's heading.

    Labelling "never restart the primary database" as `Symptom` would tell an
    operator the wrong thing about the wrong procedure.
    """
    chunks = chunk_markdown(RUNBOOK)
    merged = [c for c in chunks if "Never restart" in c.content]
    assert merged, "expected the 'Do not' section to be indexed"
    for chunk in merged:
        assert "Symptom" not in chunk.context
        # Each merged section keeps its own heading inline.
        assert "Do not" in chunk.content


def test_ordinals_are_dense_and_sequential():
    chunks = chunk_markdown(RUNBOOK)
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))


def test_oversized_paragraph_is_split_not_dropped():
    body = "# Title\n\n" + ("word " * 4000)
    chunks = chunk_text(body)
    assert len(chunks) > 1
    # Nothing may be silently lost when a unit exceeds the window.
    assert sum(len(c.content) for c in chunks) >= 4000


def test_empty_input_produces_no_chunks():
    assert chunk_text("") == []
    assert chunk_text("   \n  ") == []


def _candidate(chunk_id: str) -> Candidate:
    return Candidate(
        chunk_id=chunk_id,
        document_id="doc-1",
        collection="runbooks",
        content="...",
        context=None,
        title="Runbook",
        uri=None,
        external_id="runbook/x",
        source_type="seed",
        rerank_score=0.9,
    )


def test_valid_citations_resolve_to_chunks():
    candidates = [_candidate("c1"), _candidate("c2")]
    cited, invalid = extract_citations("Scale pgbouncer [1], not the API [2].", candidates)
    assert [c["chunk_id"] for c in cited] == ["c1", "c2"]
    assert invalid == []


def test_fabricated_citation_is_reported_and_stripped():
    candidates = [_candidate("c1")]
    answer = "Do X [1] and then Y [7]."
    cited, invalid = extract_citations(answer, candidates)
    assert [c["chunk_id"] for c in cited] == ["c1"]
    assert invalid == [7]
    # A marker pointing at a passage that was never supplied is a fabricated
    # source and must not survive into the response.
    assert strip_invalid_citations(answer, len(candidates)) == "Do X [1] and then Y ."


def test_repeated_citation_is_deduplicated():
    candidates = [_candidate("c1")]
    cited, _ = extract_citations("A [1]. B [1]. C [1].", candidates)
    assert len(cited) == 1
