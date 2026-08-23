"""A CrewAI incident-response crew that consumes the RAG service.

    python -m agents.incident_crew --incident "checkout is timing out after the deploy"
    python -m agents.incident_crew --incident "..." --dry-run    # no LLM, tools only

Three agents, run sequentially so the trace is readable during a demo:

    Triage        extract service names, error codes, symptoms; pick collections
    Investigator  gather evidence via rag_search / rag_answer, keep citations
    Remediation   propose steps grounded only in that evidence

The crew is a **consumer**. It never reaches into the retrieval or generation
code — everything goes through the public API, so the confidence gate, citation
validation and groundedness judge apply exactly as they do for any other
caller. That separation is deliberate: CrewAI carries its own LLM layer
(litellm), and letting it inside the service would break the provider-agnostic
design for no benefit. See docs/decisions.md.
"""

from __future__ import annotations

import argparse
import os
import sys
import textwrap
import time

from agents.justification import build_justification

# The crew's model is configured independently of the service's providers,
# because CrewAI routes through litellm rather than app/providers/.
CREW_MODEL = os.environ.get("CREW_MODEL", "anthropic/claude-opus-5")

GROUNDING_RULES = textwrap.dedent(
    """
    Grounding rules that override anything else you might do:
    - Every factual claim must come from a passage returned by the tools, and
      must name its source (collection/external_id or chunk_id).
    - If rag_answer returns abstained=true, the knowledge base does not contain
      the answer. Say so plainly. Do not fill the gap from your own knowledge
      without labelling it clearly as an assumption outside the corpus.
    - Never invent a runbook step, command, threshold or error code. Copy them
      verbatim from the retrieved passages — a wrong command during an incident
      is worse than no command.
    """
).strip()


def build_crew(incident: str, incident_id: str | None):
    from crewai import Agent, Crew, Process, Task

    from agents.tools import (
        RagAnswerTool,
        RagIncidentTracesTool,
        RagListCollectionsTool,
        RagPinTraceTool,
        RagSearchTool,
    )

    search = RagSearchTool()
    answer = RagAnswerTool()
    collections = RagListCollectionsTool()
    pin = RagPinTraceTool()
    history = RagIncidentTracesTool()

    triage = Agent(
        role="Incident triage analyst",
        goal=(
            "Turn a raw incident report into precise search terms: affected "
            "services, exact error codes, and which collections to search."
        ),
        backstory=(
            "You have run on-call for years. You know that the words an "
            "operator uses under pressure are rarely the words in the runbook, "
            "and that exact identifiers — error codes, service names, SQL "
            "objects — are what actually retrieve the right document."
        ),
        tools=[collections, search, history],
        llm=CREW_MODEL,
        verbose=True,
        allow_delegation=False,
    )

    investigator = Agent(
        role="Incident investigator",
        goal=(
            "Find what the knowledge base actually says about this incident, "
            "with citations, and be explicit about what it does not cover."
        ),
        backstory=(
            "You are rigorous about evidence. You would rather report a gap in "
            "the knowledge base than present a plausible guess as fact, "
            "because during an incident a confident wrong answer costs more "
            "than an honest 'not documented'."
        ),
        tools=[search, answer],
        llm=CREW_MODEL,
        verbose=True,
        allow_delegation=False,
    )

    responder = Agent(
        role="Remediation planner",
        goal="Produce an ordered, citeable remediation plan an operator can follow.",
        backstory=(
            "You write the plan the on-call engineer will actually execute at "
            "3am. Every step names its source so it can be verified, and "
            "anything not covered by the evidence is called out as a gap "
            "rather than filled in."
        ),
        tools=[search, pin],
        llm=CREW_MODEL,
        verbose=True,
        allow_delegation=False,
    )

    scope = Task(
        description=(
            f"Incident report:\n\n{incident}\n\n"
            f"First call rag_incident_traces with incident_id='{incident_id}' to "
            "see what has already been asked about this incident — another agent "
            "may have covered part of it, and repeating a query that already "
            "abstained wastes a turn.\n\n"
            "Then list the available collections, and extract: affected services, "
            "exact error codes or identifiers, observable symptoms, and which "
            "collections are worth searching. Run one or two rag_search calls "
            "to confirm your terms actually retrieve something relevant.\n\n"
            f"{GROUNDING_RULES}"
        ),
        expected_output=(
            "A short structured brief: services, identifiers, symptoms, "
            "target collections, and the search terms that worked."
        ),
        agent=triage,
    )

    investigate = Task(
        description=(
            "Using the triage brief, gather evidence. Use rag_search for raw "
            "passages and rag_answer for a grounded summary. If rag_answer "
            "abstains, report the gap and fall back to whatever rag_search "
            "returned.\n\n"
            f"{GROUNDING_RULES}"
        ),
        expected_output=(
            "Findings with, for each: the claim, its source "
            "(collection/external_id), and the chunk_id. Plus an explicit list "
            "of questions the knowledge base could not answer."
        ),
        agent=investigator,
        context=[scope],
    )

    remediate = Task(
        description=(
            "Write the remediation plan from the investigator's evidence "
            "only.\n\n"
            "Then call rag_pin_trace for every query_log_id whose answer you "
            "relied on, with a reason naming this incident. Traces are deleted "
            "after the retention window; if this plan becomes a pull request, "
            "its justification links break unless they are pinned.\n\n"
            f"{GROUNDING_RULES}"
        ),
        expected_output=textwrap.dedent(
            """
            A markdown plan:

            ## Likely cause
            One or two sentences, each citing its source.

            ## Immediate steps
            Numbered, in order. Commands copied verbatim from the passages.
            Each step names the source it came from.

            ## Do not
            Anything the runbooks explicitly warn against.

            ## Not covered by the knowledge base
            What an operator still has to determine themselves.

            ## Traces pinned
            The query_log_ids you pinned, so the reasoning stays retrievable.
            """
        ).strip(),
        agent=responder,
        context=[scope, investigate],
    )

    return Crew(
        agents=[triage, investigator, responder],
        tasks=[scope, investigate, remediate],
        process=Process.sequential,
        verbose=True,
    )


def dry_run(incident: str, incident_id: str) -> int:
    """Exercise the whole HTTP path against the live API, with no LLM and no CrewAI.

    Deliberately goes through ``agents.client`` rather than the tool classes:
    those import CrewAI at module load, so routing the dry run through them
    would make it require the very dependency it exists to avoid. What is left
    untested is CrewAI's own loop, which is what the flag promises.
    """
    from agents.client import call, dumps
    from agents.justification import build_justification

    print("dry run — calling the RAG API directly, no LLM and no CrewAI\n")

    print("── collections ──")
    collections = call("GET", "/collections")
    assert isinstance(collections, list)
    print(dumps([{"name": c["name"], "documents": c["document_count"]} for c in collections]), "\n")

    print("── search ──")
    results = call("POST", "/search", {"query": incident, "top_k": 3})
    assert isinstance(results, dict)
    print(dumps([
        {"source": r["external_id"], "score": round(r["score"], 3), "mode": r["retrieval_mode"]}
        for r in results["results"]
    ]), "\n")

    print("── answer ──")
    answer = call("POST", "/answer", {
        "query": incident, "incident_id": incident_id, "agent_id": "dry-run"})
    assert isinstance(answer, dict)
    print(dumps({
        "abstained": answer["abstained"],
        "confidence": answer["confidence"],
        "citations": [c.get("external_id") for c in answer["citations"]],
        "groundedness": (answer.get("groundedness") or {}).get("verdict"),
        "query_log_id": answer["query_log_id"],
        "prompt_versions": {k: v["version"] for k, v in (answer.get("prompt_versions") or {}).items()},
    }), "\n")

    print("── PR justification block (traces pinned) ──")
    print(build_justification(incident_id, api_url=os.environ.get("RAG_API_URL", "")))

    print("\ntools reachable — the crew's HTTP wiring works")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--incident", help="The incident report.")
    parser.add_argument(
        "--incident-id",
        default=None,
        help=(
            "Correlation id for traces. Generated per run when omitted — the "
            "service requires one, and a crew run is exactly the scope it groups."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Call the RAG API directly without invoking CrewAI or any LLM.",
    )
    parser.add_argument(
        "--justify",
        metavar="INCIDENT_ID",
        help=(
            "Print the PR justification block for an existing incident and pin "
            "its traces. Use this to regenerate the block for a run that "
            "already happened."
        ),
    )
    parser.add_argument(
        "--pr-url",
        help="Recorded as the pin reason, so a trace says which PR depends on it.",
    )
    args = parser.parse_args()

    if not os.environ.get("RAG_API_KEY"):
        print("warning: RAG_API_KEY is not set; the API will reject every call\n", file=sys.stderr)

    if args.justify:
        print(build_justification(
            args.justify, pr_url=args.pr_url,
            api_url=os.environ.get("RAG_API_URL", "")))
        return 0

    if not args.incident:
        parser.error("--incident is required unless --justify is given")

    incident_id = args.incident_id or f"crew-{int(time.time())}"

    if args.dry_run:
        return dry_run(args.incident, incident_id)

    print(f"incident_id: {incident_id}  "
          f"(replay with: GET /v1/incidents/{incident_id}/traces)\n")

    try:
        crew = build_crew(args.incident, incident_id)
    except ImportError as exc:
        print(
            f"crewai is not installed: {exc}\n"
            "  pip install -r agents/requirements.txt",
            file=sys.stderr,
        )
        return 1

    result = crew.kickoff()
    print("\n" + "=" * 70)
    print(result)

    # Built from the traces rather than from the crew's own output: what the
    # PR needs to justify a change is the evidence the service actually
    # retrieved and validated, not the agent's restatement of it.
    print("\n" + "=" * 70)
    print("PR justification block — paste into the pull request body\n")
    print(build_justification(
        incident_id, pr_url=args.pr_url, api_url=os.environ.get("RAG_API_URL", "")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
