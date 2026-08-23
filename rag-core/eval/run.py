"""Retrieval and groundedness evaluation.

The point of this harness is to make tuning falsifiable. Every knob in the
system — the embedding model, ``MIN_CONTEXT_SCORE``, the RRF weights, an edited
prompt — changes answer quality in a direction nobody can see by asking one
question and reading the reply. Without a scored run, "it seems better" is the
whole quality process.

Three things get measured, in increasing cost:

**Retrieval** (no model calls beyond embedding the query). recall@k, MRR and
precision@1 against documents named by hand as relevant. This is where a
regression from a chunking or fusion change shows up first.

**Calibration.** The confidence of answerable questions and the confidence of
unanswerable ones, reported as two distributions with the gap between them. The
abstention threshold belongs *in that gap*, and this is the only output that
says where the gap actually is. A threshold picked without it is a guess — which
is exactly what the 0.6 automation cutoff is until this runs.

**Generation.** Groundedness verdicts, citation correctness, and whether
required facts survived into the answer. ``must_mention`` exists because a
paraphrase that drops a threshold ("roll back quickly" for "2% for 5 minutes")
scores as grounded and is useless during an incident.

Run it with ``make eval``. Exit code is non-zero when a gate fails, so it works
unchanged as a CI step.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

GOLDEN_DIR = pathlib.Path(__file__).resolve().parent / "golden"


@dataclass
class CaseResult:
    case_id: str
    query: str
    should_abstain: bool
    # retrieval
    retrieved: list[str] = field(default_factory=list)
    relevant: list[str] = field(default_factory=list)
    recall: float | None = None
    mrr: float | None = None
    hit_at_1: bool | None = None
    top_confidence: float = 0.0
    # generation
    abstained: bool | None = None
    groundedness: float | None = None
    verdict: str | None = None
    cited_relevant: bool | None = None
    citation_count: int = 0
    min_citations: int | None = None
    missing_mentions: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    latency_ms: int = 0
    error: str | None = None

    @property
    def retrieval_ok(self) -> bool:
        return self.recall is None or self.recall > 0

    @property
    def abstention_ok(self) -> bool | None:
        if self.abstained is None:
            return None
        return self.abstained == self.should_abstain


def _doc_ids(sources: list[dict]) -> list[str]:
    """External ids in rank order, de-duplicated.

    Several chunks of the same document routinely appear in one result set;
    counting them separately would inflate recall to no purpose.
    """
    seen: list[str] = []
    for source in sources:
        external_id = source.get("external_id") or (source.get("metadata") or {}).get(
            "external_id"
        )
        if external_id and external_id not in seen:
            seen.append(external_id)
    return seen


def _mentions(body: str, term: str | list[str]) -> bool:
    """A required fact, allowing for the ways a model legitimately phrases it.

    A list means any-of. This is not a loophole: asserting one exact word makes
    the gate flaky rather than strict — "Restart the indexer pods" and
    "kubectl rollout restart deploy/search-indexer" are the same instruction,
    and failing one of them teaches the reader to ignore the harness.

    What must stay exact is anything an operator would copy: commands,
    thresholds, error codes, identifiers.
    """
    if isinstance(term, list):
        return any(option.lower() in body for option in term)
    return term.lower() in body


def _label(term: str | list[str]) -> str:
    return " | ".join(term) if isinstance(term, list) else term


def score_retrieval(
    retrieved: list[str], relevant: list[str], any_of: bool = False
) -> tuple[float, float, bool]:
    """recall@k, MRR and precision@1 for one case.

    ``any_of`` marks a group of documents as interchangeable — retrieving any
    one of them answers the question. Real corpora contain near-duplicates (this
    project has two `init_rbac` migrations creating the same five tables), and
    demanding every copy would score a perfectly good answer as a miss.
    """
    if not relevant:
        return 0.0, 0.0, False
    hits = [doc for doc in retrieved if doc in relevant]
    recall = (
        (1.0 if hits else 0.0) if any_of else len(set(hits)) / len(set(relevant))
    )
    mrr = 0.0
    for rank, doc in enumerate(retrieved, start=1):
        if doc in relevant:
            mrr = 1.0 / rank
            break
    return recall, mrr, bool(retrieved and retrieved[0] in relevant)


class Harness:
    def __init__(self, api: str, key: str, top_k: int, timeout: float) -> None:
        self.client = httpx.Client(
            base_url=api.rstrip("/"), headers={"X-API-Key": key}, timeout=timeout
        )
        self.top_k = top_k

    def close(self) -> None:
        self.client.close()

    def search(self, case: dict) -> list[dict]:
        response = self.client.post(
            "/search",
            json={
                "query": case["query"],
                "top_k": self.top_k,
                "collections": case.get("collections"),
                "filters": case.get("filters") or {},
            },
        )
        response.raise_for_status()
        return response.json()["results"]

    def answer(self, case: dict) -> dict:
        response = self.client.post(
            "/answer",
            json={
                "query": case["query"],
                "top_k": self.top_k,
                "collections": case.get("collections"),
                "agent_id": "eval-harness",
                "incident_id": f"EVAL-{case['id']}",
            },
        )
        response.raise_for_status()
        return response.json()

    def run_case(self, case: dict, generate: bool) -> CaseResult:
        result = CaseResult(
            case_id=case["id"],
            query=case["query"],
            should_abstain=bool(case.get("should_abstain")),
            relevant=list(case.get("relevant") or []),
        )
        started = time.perf_counter()
        try:
            sources = self.search(case)
            result.retrieved = _doc_ids(sources)
            result.top_confidence = max(
                (
                    s["scores"].get("rerank")
                    or s["scores"].get("vector")
                    or s["scores"].get("lexical")
                    or 0.0
                    for s in sources
                ),
                default=0.0,
            )
            if result.relevant:
                result.recall, result.mrr, result.hit_at_1 = score_retrieval(
                    result.retrieved, result.relevant, bool(case.get("relevant_any"))
                )

            if generate:
                answer = self.answer(case)
                result.abstained = answer["abstained"]
                result.warnings = answer.get("warnings") or []
                grounded = answer.get("groundedness") or {}
                result.groundedness = grounded.get("score")
                result.verdict = grounded.get("verdict")

                if not answer["abstained"]:
                    cited = {c.get("external_id") for c in answer.get("citations") or []}
                    result.cited_relevant = (
                        bool(cited & set(result.relevant)) if result.relevant else None
                    )
                    # Distinct documents, not citation markers: two markers into
                    # the same file are one source, and a case asserting that a
                    # conflict was reported needs two genuinely different ones.
                    result.citation_count = len(cited)
                    result.min_citations = case.get("min_citations")
                    body = (answer.get("answer") or "").lower()
                    result.missing_mentions = [
                        _label(term)
                        for term in case.get("must_mention") or []
                        if not _mentions(body, term)
                    ]
        except Exception as exc:  # noqa: BLE001
            result.error = f"{type(exc).__name__}: {exc}"
        result.latency_ms = int((time.perf_counter() - started) * 1000)
        return result


def report(results: list[CaseResult], generate: bool) -> dict:
    answerable = [r for r in results if not r.should_abstain and not r.error]
    unanswerable = [r for r in results if r.should_abstain and not r.error]

    recalls = [r.recall for r in answerable if r.recall is not None]
    mrrs = [r.mrr for r in answerable if r.mrr is not None]

    ans_conf = [r.top_confidence for r in answerable]
    una_conf = [r.top_confidence for r in unanswerable]

    summary: dict[str, Any] = {
        "cases": len(results),
        "errors": sum(1 for r in results if r.error),
        "retrieval": {
            "recall_at_k": round(statistics.fmean(recalls), 4) if recalls else None,
            "mrr": round(statistics.fmean(mrrs), 4) if mrrs else None,
            "precision_at_1": (
                round(sum(1 for r in answerable if r.hit_at_1) / len(answerable), 4)
                if answerable
                else None
            ),
            "full_recall_cases": sum(1 for r in recalls if r == 1.0),
        },
        "calibration": {
            "answerable_min": round(min(ans_conf), 4) if ans_conf else None,
            "answerable_mean": round(statistics.fmean(ans_conf), 4) if ans_conf else None,
            "unanswerable_max": round(max(una_conf), 4) if una_conf else None,
            "unanswerable_mean": round(statistics.fmean(una_conf), 4) if una_conf else None,
            # The whole point of the section. A negative gap means no threshold
            # separates the two classes and abstention cannot work on
            # confidence alone.
            "gap": (
                round(min(ans_conf) - max(una_conf), 4) if ans_conf and una_conf else None
            ),
            "suggested_threshold": (
                round((min(ans_conf) + max(una_conf)) / 2, 4)
                if ans_conf and una_conf and min(ans_conf) > max(una_conf)
                else None
            ),
        },
    }

    if generate:
        judged = [r.groundedness for r in answerable if isinstance(r.groundedness, (int, float))]
        summary["generation"] = {
            "abstention_correct": sum(
                1 for r in results if r.abstention_ok is True
            ),
            "false_answers": [r.case_id for r in unanswerable if r.abstained is False],
            "false_abstentions": [r.case_id for r in answerable if r.abstained is True],
            "groundedness_mean": round(statistics.fmean(judged), 4) if judged else None,
            "ungrounded": [
                r.case_id for r in answerable if r.verdict not in (None, "grounded")
            ],
            "missed_citations": [
                r.case_id for r in answerable if r.cited_relevant is False
            ],
            "dropped_facts": {
                r.case_id: r.missing_mentions for r in answerable if r.missing_mentions
            },
            # A case declaring min_citations asserts the answer drew on more than
            # one document — the shape of "the sources disagree, here is both".
            "under_cited": {
                r.case_id: f"{r.citation_count} of {r.min_citations} required"
                for r in answerable
                if r.min_citations and r.citation_count < r.min_citations
            },
            "with_warnings": {r.case_id: r.warnings for r in results if r.warnings},
        }
    return summary


def print_table(results: list[CaseResult], generate: bool) -> None:
    header = f"{'case':26} {'conf':>6} {'rec':>5} {'mrr':>5}"
    if generate:
        header += f" {'abst':>5} {'grnd':>5} {'cite':>5}  notes"
    print(header)
    print("-" * (len(header) + 20))
    for r in results:
        if r.error:
            print(f"{r.case_id:26} ERROR  {r.error[:60]}")
            continue
        row = (
            f"{r.case_id:26} {r.top_confidence:6.3f} "
            f"{'  —  ' if r.recall is None else f'{r.recall:5.2f}'} "
            f"{'  —  ' if r.mrr is None else f'{r.mrr:5.2f}'}"
        )
        if generate:
            expected = "yes" if r.should_abstain else "no"
            got = "yes" if r.abstained else "no"
            abst = "ok" if r.abstention_ok else f"{got}!={expected}"
            grnd = f"{r.groundedness:5.2f}" if isinstance(r.groundedness, (int, float)) else "  —  "
            cite = {True: "ok", False: "MISS", None: " — "}[r.cited_relevant]
            notes = []
            if r.missing_mentions:
                notes.append("dropped: " + ",".join(r.missing_mentions))
            if r.min_citations and r.citation_count < r.min_citations:
                notes.append(f"cited {r.citation_count}/{r.min_citations} sources")
            if r.warnings:
                notes.append(f"{len(r.warnings)} warning(s)")
            row += f" {abst:>5} {grnd} {cite:>5}  {'; '.join(notes)}"
        print(row)


GATES = {
    "recall_at_k": 0.8,
    "groundedness_mean": 0.7,
}


def check_gates(summary: dict, generate: bool) -> list[str]:
    failures = []
    recall = summary["retrieval"]["recall_at_k"]
    if recall is not None and recall < GATES["recall_at_k"]:
        failures.append(f"recall@k {recall} < {GATES['recall_at_k']}")

    gap = summary["calibration"]["gap"]
    if gap is not None and gap <= 0:
        failures.append(
            f"confidence gap is {gap}: unanswerable questions score as high as "
            f"answerable ones, so no abstention threshold can separate them"
        )
    if generate:
        gen = summary["generation"]
        if gen["false_answers"]:
            failures.append(f"answered questions it should have refused: {gen['false_answers']}")
        if gen["false_abstentions"]:
            failures.append(f"refused answerable questions: {gen['false_abstentions']}")
        mean = gen["groundedness_mean"]
        if mean is not None and mean < GATES["groundedness_mean"]:
            failures.append(f"groundedness {mean} < {GATES['groundedness_mean']}")
        if gen["dropped_facts"]:
            failures.append(f"required facts missing from answers: {gen['dropped_facts']}")
        if gen["under_cited"]:
            failures.append(
                f"answered from too few sources: {gen['under_cited']} — a case "
                f"requiring several citations is asserting that conflicting "
                f"documents were both surfaced, not just one of them"
            )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://localhost:8000/v1")
    parser.add_argument("--key", required=True, help="RAG service key (rag_sk_...)")
    parser.add_argument(
        "--dataset",
        action="append",
        metavar="PATH",
        help=(
            "Repeatable. Defaults to every dataset in eval/golden/. Each is "
            "scored and gated separately — averaging two corpora together hides "
            "which one regressed."
        ),
    )
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument(
        "--retrieval-only",
        action="store_true",
        help="Skip generation. No LLM tokens, so this is the one to run on every change.",
    )
    parser.add_argument("--json", dest="json_out", help="Write the full report here")
    args = parser.parse_args()

    paths = [pathlib.Path(p) for p in args.dataset] if args.dataset else sorted(
        GOLDEN_DIR.glob("*.json")
    )
    if not paths:
        print(f"no datasets found in {GOLDEN_DIR}", file=sys.stderr)
        return 2

    generate = not args.retrieval_only
    harness = Harness(args.api, args.key, args.top_k, args.timeout)
    report_out: dict[str, dict] = {}
    failures: dict[str, list[str]] = {}

    try:
        for path in paths:
            dataset = json.loads(path.read_text())
            print(f"\n{'=' * 72}")
            print(f"{dataset['name']}  ({path.name}) — {len(dataset['cases'])} cases, "
                  f"{'retrieval + generation' if generate else 'retrieval only'}")
            print("=" * 72)
            results = [harness.run_case(case, generate) for case in dataset["cases"]]

            print_table(results, generate)
            summary = report(results, generate)
            print("\n" + json.dumps(summary, indent=2))

            calibration = summary["calibration"]
            if calibration["suggested_threshold"] is not None:
                print(
                    f"\nMIN_CONTEXT_SCORE sits between "
                    f"{calibration['unanswerable_max']} (highest unanswerable) and "
                    f"{calibration['answerable_min']} (lowest answerable). "
                    f"Midpoint: {calibration['suggested_threshold']}"
                )

            report_out[dataset["name"]] = {
                "summary": summary,
                "cases": [vars(r) for r in results],
            }
            found = check_gates(summary, generate)
            if found:
                failures[dataset["name"]] = found
    finally:
        harness.close()

    if args.json_out:
        pathlib.Path(args.json_out).write_text(json.dumps(report_out, indent=2))
        print(f"\nreport written to {args.json_out}")

    # One threshold serves every corpus, so a suggestion that fits one and not
    # the other is a real finding rather than a rounding difference.
    suggestions = {
        name: r["summary"]["calibration"]["suggested_threshold"]
        for name, r in report_out.items()
        if r["summary"]["calibration"]["suggested_threshold"] is not None
    }
    if len(suggestions) > 1:
        print(f"\nsuggested thresholds per corpus: {suggestions}")
        spread = max(suggestions.values()) - min(suggestions.values())
        if spread > 0.05:
            print(
                f"  these differ by {spread:.4f}. MIN_CONTEXT_SCORE is global, so "
                f"one corpus is being served worse than the other — consider "
                f"enabling the reranker rather than splitting the difference."
            )

    print(f"\n{'=' * 72}")
    if failures:
        print("FAILED:")
        for name, found in failures.items():
            print(f"  {name}:")
            for failure in found:
                print(f"    - {failure}")
        return 1
    print(f"all gates passed ({len(paths)} dataset{'s' if len(paths) > 1 else ''})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
