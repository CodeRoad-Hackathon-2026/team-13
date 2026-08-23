"""Turn an incident's traces into a PR-ready justification block.

This is the handoff between the crew and whatever opens the pull request. An
agent that proposes a code change has to be able to answer "why", and the
honest answer is not the agent's own summary — it is the passages the service
actually retrieved, the citations that survived validation, and the judge's
verdict on whether the answer was supported.

Two things are produced together, and both matter:

* **A markdown block** that is embedded in the PR body. It survives any
  retention policy because it lives in git, and it reads without a network
  call.
* **A pin on every trace it cites.** A merged PR lives in git history forever;
  an unpinned trace is deleted after ``TRACE_RETENTION_DAYS``. Without the pin
  the "full trace" link 404s exactly when someone audits the decision.

The snapshot and the link are not redundant. The snapshot is what a reader sees
in a year; the link gives the complete eight-passage context while the trace
exists.
"""

from __future__ import annotations

from agents.client import API_URL, call


def _fmt_score(value: object) -> str:
    return f"{value:.2f}" if isinstance(value, (int, float)) else "—"


def _dedupe_citations(citations: list[dict]) -> list[dict]:
    """One entry per document, keeping its best-scoring chunk.

    Several chunks of the same runbook are routinely cited. Listing the file
    twice with two different relevance numbers reads as a bug in a PR body,
    and the document is the unit a reviewer actually opens.
    """
    best: dict[str, dict] = {}
    for citation in citations:
        key = citation.get("external_id") or citation.get("chunk_id") or ""
        current = best.get(key)
        if current is None or (citation.get("score") or 0) > (current.get("score") or 0):
            best[key] = citation
    return list(best.values())


def fetch_incident(incident_id: str) -> list[dict]:
    payload = call("GET", f"/incidents/{incident_id}/traces")
    assert isinstance(payload, dict)
    return payload["traces"]


def pin_traces(traces: list[dict], reason: str) -> list[str]:
    """Pin every trace, reporting rather than raising on individual failures.

    A pin that fails must not lose the justification block — the snapshot is
    still correct, the link is merely fragile, and that is worth saying out
    loud rather than aborting the run.
    """
    pinned: list[str] = []
    for trace in traces:
        try:
            call("POST", f"/traces/{trace['id']}/pin", {"reason": reason})
            pinned.append(trace["id"])
        except RuntimeError as exc:  # noqa: PERF203
            print(f"  warning: could not pin {trace['id']}: {exc}")
    return pinned


def build_justification(
    incident_id: str,
    *,
    pr_url: str | None = None,
    api_url: str | None = None,
    pin: bool = True,
) -> str:
    """Render the block. Returns a message rather than failing when empty."""
    traces = fetch_incident(incident_id)
    if not traces:
        return (
            f"No traces recorded for `{incident_id}`. Either nothing was asked "
            f"under that id, or the calls omitted `incident_id` — the service "
            f"requires it precisely so this cannot happen silently."
        )

    if pin:
        pin_traces(traces, pr_url or f"justification for {incident_id}")

    # Falls back to the configured API_URL, which carries a scheme. A bare
    # host produces a link that renders but does not resolve from a PR body.
    base = (api_url or API_URL).rstrip("/")
    if base and "://" not in base:
        base = f"http://{base}"
    lines: list[str] = [
        "## Why this change",
        "",
        f"Grounded in the operational knowledge base under incident `{incident_id}`. "
        f"Every claim below is quoted from an indexed document, not produced from "
        f"model knowledge.",
        "",
    ]

    abstentions: list[dict] = []
    models: set[str] = set()
    prompt_note: set[str] = set()

    # Counted separately from the loop index: abstentions are rendered in
    # their own section, so using the enumerate index would leave gaps in the
    # numbering here.
    index = 0
    for trace in traces:
        if trace.get("abstained"):
            abstentions.append(trace)
            continue
        index += 1
        if trace.get("llm_model"):
            models.add(trace["llm_model"])
        for key, version in (trace.get("prompt_versions") or {}).items():
            if isinstance(version, dict) and version.get("version", 1) > 1:
                prompt_note.add(f"{key} v{version['version']}")

        grounded = trace.get("groundedness") or {}
        lines += [
            f"### {index}. {trace['query']}",
            "",
            (trace.get("answer") or "").strip(),
            "",
        ]

        citations = _dedupe_citations(trace.get("citations") or [])
        if citations:
            lines.append("**Sources**")
            lines.append("")
            for citation in citations:
                label = citation.get("external_id") or citation.get("chunk_id")
                title = citation.get("title")
                uri = citation.get("uri")
                name = f"[{label}]({uri})" if uri else f"`{label}`"
                lines.append(
                    f"- {name}"
                    + (f" — {title}" if title and title != label else "")
                    + f" (relevance {_fmt_score(citation.get('score'))})"
                )
            lines.append("")

        verdict = grounded.get("verdict")
        if verdict:
            lines.append(
                f"**Groundedness:** {verdict} ({_fmt_score(grounded.get('score'))}) — "
                f"an independent model checked each claim against the passages above."
            )
            if grounded.get("reasoning"):
                lines += ["", f"> {grounded['reasoning'].strip()}"]
            unsupported = grounded.get("unsupported_claims") or []
            if unsupported:
                lines += ["", "**Claims the passages did not support:**"]
                lines += [f"- {claim}" for claim in unsupported]
            lines.append("")

        if base:
            lines += [f"[Full trace]({base}/traces/{trace['id']})", ""]

    if abstentions:
        lines += [
            "### Not covered by the knowledge base",
            "",
            "The service declined to answer these rather than guessing. "
            "They are gaps a human still has to close:",
            "",
        ]
        lines += [f"- {t['query']}" for t in abstentions]
        lines.append("")

    lines += ["---", ""]
    plural = "query" if len(traces) == 1 else "queries"
    provenance = [f"incident `{incident_id}`", f"{len(traces)} {plural}"]
    if models:
        provenance.append("model " + ", ".join(sorted(models)))
    if prompt_note:
        provenance.append("non-default prompts: " + ", ".join(sorted(prompt_note)))
    lines.append(
        "*Generated from "
        + " · ".join(provenance)
        + ". Traces are pinned, so the links above outlive the retention window.*"
    )
    return "\n".join(lines)
