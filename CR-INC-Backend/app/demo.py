"""Puts the system into a state worth looking at.

Seeds the RAG corpus, then sends a handful of incidents through the real
pipeline — intake, classification, retrieval, decision — so the dashboard has
live work on it rather than only fixture rows.

    docker compose run --rm orchestrator python -m app.demo

Reproducible from nothing: `docker compose down -v && docker compose up -d`
resets the database, and this refills it.
"""

from __future__ import annotations

import asyncio
import logging

from app import corpus
from app.agents.pipeline import intake_and_triage
from app.config import settings
from app.db import close_pool
from app.rag_client import RagClient

logger = logging.getLogger(__name__)

# Chosen to exercise different paths: the first two should match the seeded
# runbooks and come back known, the third should not match anything and stay
# unknown — which is what a documentation candidate looks like.
INCIDENTS = [
    {
        "external_id": "DEMO-1001",
        "subject": "payments-api connection pool exhausted",
        "body": "240 of 240 slots busy for 12 minutes. Checkout latency tripled and the "
        "error rate is climbing.",
        "source": "pagerduty",
        "environment": "prod",
    },
    {
        "external_id": "DEMO-1002",
        "subject": "Stale pricing served from the edge after deploy",
        "body": "CDN still returning pre-deploy prices for tag `pricing` in eu-west.",
        "source": "slack",
        "environment": "prod",
    },
    {
        "external_id": "DEMO-1003",
        "subject": "Split-tender totals off by one cent",
        "body": "Rounding drifts when a payment is split across two tenders. No runbook "
        "covers this.",
        "source": "email",
        "environment": "prod",
    },
]


async def main() -> int:
    logging.basicConfig(level=settings.log_level, format="%(levelname)s: %(message)s")

    print("seeding the RAG corpus…")
    seeded = await corpus.sync()
    print(f"  {seeded['ingested']} of {seeded['total']} documents ingested")
    if seeded["failed"]:
        # Without a corpus the agents abstain, and the walkthrough shows nothing.
        print(f"  {seeded['failed']} failed — the pipeline will abstain without them")

    client = RagClient()
    try:
        for payload in INCIDENTS:
            print(f"\ningesting {payload['external_id']} — {payload['subject']}")
            result = await intake_and_triage(payload, client)

            if not result["created"]:
                print("  already present, skipped")
                continue

            for step in ("classification", "retrieval", "decision"):
                outcome = result.get(step)
                print(f"  {step:<15} {_describe(step, outcome)}")
    finally:
        await client.aclose()
        await close_pool()

    print("\nopen http://localhost:8900")
    return 0


def _describe(step: str, outcome: dict | None) -> str:
    if outcome is None:
        return "did not run"
    output = outcome.get("output") or {}
    if step == "classification":
        if not output.get("classified"):
            return f"abstained — {output.get('reason')}"
        return f"{output.get('category')} / {output.get('priority')}"
    if step == "retrieval":
        return (
            f"{output.get('linked')} matches linked, best {output.get('best_score')}"
            f"{' — known incident' if output.get('is_known_incident') else ''}"
        )
    if not output.get("proposed"):
        return f"proposed nothing — {output.get('reason')}"
    return f"{output.get('action_type')} proposed, risk {output.get('risk_level')}"


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
