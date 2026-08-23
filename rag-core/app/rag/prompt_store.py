"""Database-backed prompts with immutable versions.

Prompts are the one part of a RAG system that everybody wants to tune and that
nothing protects. Moving them into the database buys three things:

* tuning without a deploy;
* an audit trail — a trace records the exact version that produced it, so an
  answer from last month stays explainable after the prompt has moved on;
* a rollback that is one click rather than a revert commit.

It also introduces a way to break the system silently, which is why
``validate_body`` exists. An ``answer_template`` saved without ``{context}``
still renders — the model simply receives no passages and answers from its own
knowledge. Every guardrail downstream keeps reporting success, because citations
and groundedness are checked against a context that was never sent. That failure
is caught at save time here, never at request time.

The constants in ``app.rag.prompts`` remain the seeded version 1 and the
fallback whenever the database is unreachable.
"""

from __future__ import annotations

import logging
import string
import time
from dataclasses import dataclass, field
from typing import Any

from app.db import get_pool
from app.rag import prompts

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PromptDef:
    key: str
    label: str
    description: str
    default: str
    # Placeholders the body must contain, and the complete set it may contain.
    required_placeholders: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "description": self.description,
            "default": self.default,
            "required_placeholders": list(self.required_placeholders),
        }


PROMPT_DEFS: tuple[PromptDef, ...] = (
    PromptDef(
        "answer_system",
        "Answer — system",
        "Rules the generator follows. Kept short on purpose: long prohibition "
        "lists make current models hedge, and the real guarantees here are "
        "mechanical, not textual.",
        prompts.ANSWER_SYSTEM,
    ),
    PromptDef(
        "answer_template",
        "Answer — user template",
        "How the passages and the question are presented to the generator.",
        prompts.ANSWER_TEMPLATE,
        required_placeholders=("context", "question"),
    ),
    PromptDef(
        "groundedness_system",
        "Groundedness judge — system",
        "How the judge decides whether a claim is supported. Changing the "
        "definition of `score` changes what MIN_GROUNDEDNESS_SCORE means.",
        prompts.GROUNDEDNESS_SYSTEM,
    ),
    PromptDef(
        "groundedness_template",
        "Groundedness judge — user template",
        "How the answer and its passages are presented to the judge.",
        prompts.GROUNDEDNESS_TEMPLATE,
        required_placeholders=("context", "answer"),
    ),
    PromptDef(
        "abstain_message",
        "Abstention message",
        "Returned verbatim when retrieval is below the confidence threshold. "
        "No model call happens, so this is the literal response text.",
        prompts.ABSTAIN_MESSAGE,
    ),
)

PROMPTS_BY_KEY = {d.key: d for d in PROMPT_DEFS}


class PromptValidationError(ValueError):
    """A prompt body that would break generation at request time."""


def validate_body(key: str, body: str) -> None:
    definition = PROMPTS_BY_KEY.get(key)
    if definition is None:
        raise PromptValidationError(f"unknown prompt key '{key}'")
    if not body.strip():
        raise PromptValidationError("prompt body cannot be empty")

    allowed = set(definition.required_placeholders)
    try:
        found = {
            name for _, name, _, _ in string.Formatter().parse(body) if name is not None
        }
    except ValueError as exc:
        raise PromptValidationError(f"unbalanced braces: {exc}") from exc

    # An unknown placeholder raises KeyError inside str.format() at request
    # time — which is to say, in production, on a real incident. A literal
    # brace has to be doubled.
    unknown = found - allowed
    if unknown:
        raise PromptValidationError(
            f"unknown placeholder(s) {sorted(unknown)}; this prompt accepts "
            f"{sorted(allowed) or 'none'}. Write a literal brace as {{{{ or }}}}."
        )

    missing = allowed - found
    if missing:
        raise PromptValidationError(
            f"missing required placeholder(s) {sorted(missing)}. "
            f"Without them the model is not given the data they carry."
        )


@dataclass
class PromptSet:
    """Resolved prompts for one request, plus what produced them."""

    bodies: dict[str, str]
    versions: dict[str, Any] = field(default_factory=dict)

    def __getattr__(self, name: str) -> str:
        try:
            return self.bodies[name]
        except KeyError as exc:  # pragma: no cover - programming error
            raise AttributeError(name) from exc


DEFAULT_SET = PromptSet(bodies={d.key: d.default for d in PROMPT_DEFS}, versions={})

# The API and the worker are separate processes, so an in-process cache cannot
# be invalidated across them. A short TTL is what actually bounds staleness;
# invalidate() only makes the editing process feel immediate.
_CACHE_TTL_SECONDS = 10.0
_cache: dict[str | None, tuple[float, PromptSet]] = {}


def invalidate() -> None:
    _cache.clear()


async def seed_defaults() -> None:
    """Insert the code constants as version 1 of each global prompt.

    Idempotent: a prompt that already exists is left alone, so an edited prompt
    is not reset by a restart.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        for definition in PROMPT_DEFS:
            async with conn.transaction():
                prompt_id = await conn.fetchval(
                    """
                    INSERT INTO prompts (key, collection_id, description)
                    VALUES ($1, NULL, $2)
                    ON CONFLICT (key, collection_id) DO NOTHING
                    RETURNING id
                    """,
                    definition.key,
                    definition.description,
                )
                if prompt_id is None:
                    continue  # already seeded
                await conn.execute(
                    """
                    INSERT INTO prompt_versions
                        (prompt_id, version, body, note, created_by, is_active)
                    VALUES ($1, 1, $2, 'seeded from app/rag/prompts.py', 'system', true)
                    """,
                    prompt_id,
                    definition.default,
                )
    logger.info("prompt defaults seeded")
    invalidate()


async def get_prompt_set(collection: str | None = None) -> PromptSet:
    """Active prompts, with a collection override applied where one exists.

    ``collection`` is honoured only when a request targets exactly one
    collection. A query spanning several has no single correct override, and
    picking one arbitrarily would make the same question answer differently
    depending on collection ordering.
    """
    now = time.monotonic()
    cached = _cache.get(collection)
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT p.key, p.collection_id, v.id AS version_id, v.version, v.body
                FROM prompts p
                JOIN prompt_versions v ON v.prompt_id = p.id AND v.is_active
                LEFT JOIN collections c ON c.id = p.collection_id
                WHERE p.collection_id IS NULL OR c.name = $1
                """,
                collection,
            )
    except Exception:  # noqa: BLE001
        # Generation must not fail because the prompt table is unreachable.
        logger.exception("prompt lookup failed; falling back to code defaults")
        return DEFAULT_SET

    bodies = dict(DEFAULT_SET.bodies)
    versions: dict[str, Any] = {}
    # Global first, then the collection override lands on top of it.
    for row in sorted(rows, key=lambda r: r["collection_id"] is not None):
        bodies[row["key"]] = row["body"]
        versions[row["key"]] = {
            "version_id": str(row["version_id"]),
            "version": row["version"],
            "scope": collection if row["collection_id"] is not None else "global",
        }

    resolved = PromptSet(bodies=bodies, versions=versions)
    _cache[collection] = (now, resolved)
    return resolved


# ------------------------------------------------------------------- editing
async def list_prompts() -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.id, p.key, c.name AS collection, p.description,
                   v.id AS version_id, v.version, v.body, v.note,
                   v.created_at, v.created_by,
                   (SELECT count(*) FROM prompt_versions pv WHERE pv.prompt_id = p.id)
                       AS version_count
            FROM prompts p
            LEFT JOIN collections c ON c.id = p.collection_id
            LEFT JOIN prompt_versions v ON v.prompt_id = p.id AND v.is_active
            ORDER BY p.key, c.name NULLS FIRST
            """
        )
    out = []
    for row in rows:
        definition = PROMPTS_BY_KEY.get(row["key"])
        out.append(
            {
                "id": str(row["id"]),
                "key": row["key"],
                "collection": row["collection"],
                "label": definition.label if definition else row["key"],
                "description": row["description"] or (definition.description if definition else ""),
                "required_placeholders": (
                    list(definition.required_placeholders) if definition else []
                ),
                "version_id": str(row["version_id"]) if row["version_id"] else None,
                "version": row["version"],
                "body": row["body"],
                "note": row["note"],
                "created_at": row["created_at"],
                "created_by": row["created_by"],
                "version_count": row["version_count"],
                "is_default": row["body"] == (definition.default if definition else None),
            }
        )
    return out


async def history(key: str, collection: str | None = None) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT v.id, v.version, v.body, v.note, v.created_at, v.created_by, v.is_active
            FROM prompt_versions v
            JOIN prompts p ON p.id = v.prompt_id
            LEFT JOIN collections c ON c.id = p.collection_id
            WHERE p.key = $1
              AND ($2::text IS NULL AND p.collection_id IS NULL OR c.name = $2)
            ORDER BY v.version DESC
            """,
            key,
            collection,
        )
    return [{**dict(r), "id": str(r["id"])} for r in rows]


async def save_version(
    key: str,
    body: str,
    *,
    collection: str | None = None,
    note: str | None = None,
    created_by: str | None = None,
    activate: bool = True,
) -> dict:
    """Write a new version and, by default, make it the active one."""
    validate_body(key, body)
    definition = PROMPTS_BY_KEY[key]

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            collection_id = None
            if collection is not None:
                collection_id = await conn.fetchval(
                    "SELECT id FROM collections WHERE name = $1", collection
                )
                if collection_id is None:
                    raise ValueError(f"collection '{collection}' does not exist")

            prompt_id = await conn.fetchval(
                """
                INSERT INTO prompts (key, collection_id, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (key, collection_id) DO UPDATE SET key = EXCLUDED.key
                RETURNING id
                """,
                key,
                collection_id,
                definition.description,
            )

            current = await conn.fetchrow(
                """
                SELECT id, version, body FROM prompt_versions
                WHERE prompt_id = $1 ORDER BY version DESC LIMIT 1
                """,
                prompt_id,
            )
            if current and current["body"] == body:
                # Saving an unchanged body would grow the history with versions
                # that differ in nothing, making the real changes hard to find.
                return {
                    "id": str(current["id"]),
                    "version": current["version"],
                    "unchanged": True,
                }

            next_version = (current["version"] + 1) if current else 1
            if activate:
                await conn.execute(
                    "UPDATE prompt_versions SET is_active = false WHERE prompt_id = $1",
                    prompt_id,
                )
            row = await conn.fetchrow(
                """
                INSERT INTO prompt_versions
                    (prompt_id, version, body, note, created_by, is_active)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, version, is_active
                """,
                prompt_id,
                next_version,
                body,
                note,
                created_by,
                activate,
            )
    invalidate()
    return {"id": str(row["id"]), "version": row["version"], "is_active": row["is_active"]}


async def activate_version(version_id: str) -> dict:
    """Roll back (or forward) to an existing version."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            prompt_id = await conn.fetchval(
                "SELECT prompt_id FROM prompt_versions WHERE id = $1", version_id
            )
            if prompt_id is None:
                raise ValueError("version not found")
            await conn.execute(
                "UPDATE prompt_versions SET is_active = false WHERE prompt_id = $1",
                prompt_id,
            )
            row = await conn.fetchrow(
                """
                UPDATE prompt_versions SET is_active = true WHERE id = $1
                RETURNING id, version
                """,
                version_id,
            )
    invalidate()
    return {"id": str(row["id"]), "version": row["version"]}


async def reset_to_default(key: str, collection: str | None = None) -> dict:
    """Save the code constant as a new version rather than deleting history."""
    return await save_version(
        key,
        PROMPTS_BY_KEY[key].default,
        collection=collection,
        note="reset to the shipped default",
        created_by="system",
    )
