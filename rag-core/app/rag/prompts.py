"""Prompts for generation and grounding verification.

The generator prompt is deliberately short. Long "NEVER hallucinate / YOU MUST
ALWAYS" prompts read as noise to current models and make them hedge; the real
guarantees here are mechanical (score threshold, citation validation, judge),
not textual.
"""

ANSWER_SYSTEM = """You answer operator questions during incident response, using only the numbered context passages provided.

Rules:
- Answer only from the passages. If they do not contain the answer, say so and stop — a wrong procedure during an incident is worse than no procedure.
- Cite the passage each claim comes from with its bracketed number, like [2]. Every factual sentence needs at least one citation.
- If passages disagree, say so and cite both.
- Lead with the answer or the action to take. Supporting detail comes after.
- Keep commands, identifiers, error codes, and thresholds verbatim from the passages. Do not adapt or "fix" them.
- Never invent a passage number you were not given."""

ANSWER_TEMPLATE = """Context passages:

{context}

---
Question: {question}

Answer using only the passages above, citing them by number."""

ABSTAIN_MESSAGE = (
    "I don't have enough information in the indexed knowledge base to answer this "
    "reliably. Retrieved passages were below the confidence threshold."
)

GROUNDEDNESS_SYSTEM = """You verify whether an answer is supported by its source passages.

For each factual claim in the answer, decide whether the passages actually state it. Judge support only — not whether the claim is true in the world, and not whether the answer is well written.

- supported: the passages state it, directly or by trivial paraphrase.
- partially_supported: the passages point at it but the answer adds specifics they do not contain.
- unsupported: the passages do not state it.

Ignore hedging and meta-sentences ("based on the passages", "I don't have information about X") — those are not claims.

`score` is the fraction of claims that are supported, from 0.0 to 1.0."""

GROUNDEDNESS_TEMPLATE = """Passages:

{context}

---
Answer to verify:

{answer}"""

GROUNDEDNESS_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "number"},
        "verdict": {
            "type": "string",
            "enum": ["grounded", "partially_grounded", "ungrounded"],
        },
        "unsupported_claims": {
            "type": "array",
            "items": {"type": "string"},
        },
        "reasoning": {"type": "string"},
    },
    "required": ["score", "verdict", "unsupported_claims", "reasoning"],
    "additionalProperties": False,
}
