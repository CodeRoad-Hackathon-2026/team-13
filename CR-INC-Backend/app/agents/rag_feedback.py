"""Sends an operator's verdict back to RAG Core.

A rejection is the most informative signal this system produces: a human looked
at grounded evidence and said no. RAG Core's hybrid ranking carries a feedback
component, so returning it makes the sources behind a bad recommendation rank
lower next time. Without this, the judgement stops at our database.
"""

from __future__ import annotations

import json
import logging

import asyncpg

from app.rag_client import RagClient, RagError

logger = logging.getLogger(__name__)

# The Decision Agent stores RAG Core's query_log_id in its run output; that id is
# what makes the feedback attachable to the retrieval it judges.
QUERY_LOG_FOR_ACTION = """
SELECT r.output ->> 'query_log_id' AS query_log_id
FROM recommended_actions ra
JOIN agent_runs r ON r.id = ra.agent_run_id
WHERE ra.id = $1
"""


async def report_rejection(
    conn: asyncpg.Connection, action_id: str, reason: str, rag: RagClient
) -> bool:
    """Report a rejected recommendation. Returns whether anything was sent.

    Best-effort by design: the rejection is already recorded locally, and the
    operator's action must not fail because the RAG is unreachable. A miss is
    logged, not raised.
    """
    query_log_id = await conn.fetchval(QUERY_LOG_FOR_ACTION, action_id)
    if not query_log_id:
        # Nothing to attach the verdict to — the action predates the Decision
        # Agent, or its run recorded no query log.
        logger.info("no query_log_id for action %s; skipping RAG feedback", action_id)
        return False

    try:
        await rag.submit_feedback(query_log_id=query_log_id, rating=-1, reason=reason)
    except RagError as exc:
        logger.warning("could not report rejection of %s to RAG Core: %s", action_id, exc)
        return False
    return True
