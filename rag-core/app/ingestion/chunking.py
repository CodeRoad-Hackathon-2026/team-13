"""Structure-aware chunking.

Splitting on a fixed character count cuts runbooks mid-procedure and stack
traces mid-frame, which is exactly the content an incident agent needs intact.
The splitter walks a hierarchy of separators (headings, then paragraphs, then
lines, then sentences) and only falls back to hard slicing when a single
atomic unit exceeds the budget.

Each chunk carries the heading path it came from, so the model sees
"Runbook > Payments > Rollback" instead of an anonymous paragraph.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.config import settings

# ~4 characters per token is close enough for budgeting; the exact count comes
# from the provider at embed time and is stored per chunk.
CHARS_PER_TOKEN = 4

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass
class Chunk:
    content: str
    ordinal: int
    context: str = ""
    token_count: int = 0
    metadata: dict = field(default_factory=dict)


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def _split_oversized(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    """Last resort: slide a window over a unit that cannot be split further."""
    pieces: list[str] = []
    start = 0
    step = max(max_chars - overlap_chars, 1)
    while start < len(text):
        pieces.append(text[start : start + max_chars])
        start += step
    return pieces


def _split_by_separators(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    """Greedily pack progressively finer units into max_chars windows."""
    if len(text) <= max_chars:
        return [text]

    for separator in ("\n\n", "\n", None):
        units = (
            text.split(separator)
            if separator is not None
            else _SENTENCE_RE.split(text)
        )
        if len(units) < 2:
            continue
        joiner = separator if separator is not None else " "

        packed: list[str] = []
        current = ""
        for unit in units:
            candidate = f"{current}{joiner}{unit}" if current else unit
            if len(candidate) <= max_chars:
                current = candidate
                continue
            if current:
                packed.append(current)
            # A single unit larger than the window still needs slicing.
            if len(unit) > max_chars:
                sliced = _split_oversized(unit, max_chars, overlap_chars)
                packed.extend(sliced[:-1])
                current = sliced[-1]
            else:
                current = unit
        if current:
            packed.append(current)
        if len(packed) > 1:
            return packed

    return _split_oversized(text, max_chars, overlap_chars)


def _common_prefix(paths: list[list[str]]) -> list[str]:
    """Deepest heading path shared by every section in a merged group."""
    if not paths:
        return []
    shared = list(paths[0])
    for path in paths[1:]:
        cut = 0
        while cut < min(len(shared), len(path)) and shared[cut] == path[cut]:
            cut += 1
        shared = shared[:cut]
    return shared


def _apply_overlap(pieces: list[str], overlap_chars: int) -> list[str]:
    """Prefix each chunk with the tail of the previous one.

    Overlap is what keeps a procedure readable when step 3 lands at a chunk
    boundary: the chunk that starts at step 4 still carries step 3's context.
    """
    if overlap_chars <= 0 or len(pieces) < 2:
        return pieces
    out = [pieces[0]]
    for previous, current in zip(pieces, pieces[1:]):
        tail = previous[-overlap_chars:].lstrip()
        out.append(f"{tail}\n{current}" if tail else current)
    return out


def chunk_markdown(text: str, *, base_metadata: dict | None = None) -> list[Chunk]:
    """Split on the markdown heading tree, then pack each section."""
    max_chars = settings.chunk_max_tokens * CHARS_PER_TOKEN
    overlap_chars = settings.chunk_overlap_tokens * CHARS_PER_TOKEN
    min_chars = settings.chunk_min_tokens * CHARS_PER_TOKEN
    base_metadata = base_metadata or {}

    sections: list[tuple[list[str], list[str]]] = []  # (heading path, lines)
    heading_path: list[str] = []
    buffer: list[str] = []

    def flush() -> None:
        if buffer and "".join(buffer).strip():
            sections.append((list(heading_path), list(buffer)))
        buffer.clear()

    for line in text.splitlines():
        match = _HEADING_RE.match(line)
        if match:
            flush()
            level = len(match.group(1))
            heading_path[:] = heading_path[: level - 1]
            heading_path.append(match.group(2).strip())
        else:
            buffer.append(line)
    flush()

    if not sections:
        sections = [([], text.splitlines())]

    chunks: list[Chunk] = []
    ordinal = 0
    # Sections too small to stand alone are merged forward. `pending` holds the
    # (path, body) pairs waiting to be flushed together.
    pending: list[tuple[list[str], str]] = []

    def render(group: list[tuple[list[str], str]]) -> tuple[str, list[str]]:
        """Return (body, heading_path) for a group of merged sections.

        A merged chunk must not inherit the first section's heading: labelling
        "never restart the primary database" as `Symptom` misattributes the
        instruction to the wrong procedure. Instead the chunk is labelled with
        the deepest heading the merged sections actually share, and each
        section keeps its own heading inline in the text.
        """
        if len(group) == 1:
            return group[0][1], group[0][0]
        shared = _common_prefix([path for path, _ in group])
        parts = []
        for path, body in group:
            depth = max(len(path), 1)
            heading = f"{'#' * depth} {path[-1]}\n\n" if path else ""
            parts.append(f"{heading}{body}")
        return "\n\n".join(parts), shared

    def flush(group: list[tuple[list[str], str]]) -> None:
        nonlocal ordinal
        if not group:
            return
        body, path = render(group)
        context = " > ".join(path)
        for piece in _apply_overlap(
            _split_by_separators(body, max_chars, overlap_chars), overlap_chars
        ):
            piece = piece.strip()
            if not piece:
                continue
            # The heading path is prepended to the embedded text: a chunk that
            # says "restart the pods" is meaningless without knowing which
            # service section it came from.
            content = f"{context}\n\n{piece}" if context else piece
            chunks.append(
                Chunk(
                    content=content,
                    ordinal=ordinal,
                    context=context,
                    token_count=estimate_tokens(content),
                    metadata={**base_metadata, "heading_path": path},
                )
            )
            ordinal += 1

    for path, lines in sections:
        body = "\n".join(lines).strip()
        if not body:
            continue
        pending.append((path, body))
        if sum(len(b) for _, b in pending) >= min_chars:
            flush(pending)
            pending = []

    flush(pending)
    return chunks


_SQL_OBJECT_RE = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:GLOBAL\s+|LOCAL\s+|TEMP\s+|TEMPORARY\s+|MATERIALIZED\s+|UNIQUE\s+)*"
    r"(TABLE|VIEW|INDEX|FUNCTION|PROCEDURE|TRIGGER|TYPE|SCHEMA|SEQUENCE)\s+"
    r"(?:IF\s+NOT\s+EXISTS\s+)?([\w.\"`\[\]]+)",
    re.IGNORECASE,
)


def split_sql_statements(text: str) -> list[str]:
    """Split SQL on statement boundaries, respecting quotes and comments.

    A naive ``text.split(';')`` breaks on semicolons inside string literals and
    inside dollar-quoted function bodies — which is most of a Postgres
    migration file. Splitting a ``CREATE FUNCTION`` mid-body produces chunks
    that retrieve as plausible SQL but are not runnable, which is worse than
    not retrieving them.
    """
    statements: list[str] = []
    buffer: list[str] = []
    i = 0
    n = len(text)
    dollar_tag: str | None = None
    in_single = in_double = in_line_comment = in_block_comment = False

    while i < n:
        char = text[i]
        pair = text[i : i + 2]

        if in_line_comment:
            if char == "\n":
                in_line_comment = False
        elif in_block_comment:
            if pair == "*/":
                in_block_comment = False
                buffer.append(pair)
                i += 2
                continue
        elif dollar_tag is not None:
            if text.startswith(dollar_tag, i):
                buffer.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
        elif in_single:
            if char == "'":
                in_single = False
        elif in_double:
            if char == '"':
                in_double = False
        else:
            if pair == "--":
                in_line_comment = True
            elif pair == "/*":
                in_block_comment = True
                buffer.append(pair)
                i += 2
                continue
            elif char == "'":
                in_single = True
            elif char == '"':
                in_double = True
            elif char == "$":
                match = re.match(r"\$[\w]*\$", text[i:])
                if match:
                    dollar_tag = match.group(0)
                    buffer.append(dollar_tag)
                    i += len(dollar_tag)
                    continue
            elif char == ";":
                buffer.append(char)
                statements.append("".join(buffer).strip())
                buffer = []
                i += 1
                continue

        buffer.append(char)
        i += 1

    tail = "".join(buffer).strip()
    if tail:
        statements.append(tail)
    return [s for s in statements if s]


def chunk_sql(text: str, *, base_metadata: dict | None = None) -> list[Chunk]:
    """Chunk SQL by statement, grouped up to the token budget.

    Each chunk is labelled with the database objects it defines, so a query for
    "orders table schema" can match on the object name even when the DDL body
    itself never repeats it.
    """
    max_chars = settings.chunk_max_tokens * CHARS_PER_TOKEN
    base_metadata = base_metadata or {}

    groups: list[list[str]] = []
    current: list[str] = []
    size = 0
    for statement in split_sql_statements(text):
        # An oversized single statement stays whole: a half CREATE TABLE is
        # not useful to anyone.
        if current and size + len(statement) > max_chars:
            groups.append(current)
            current, size = [], 0
        current.append(statement)
        size += len(statement)
    if current:
        groups.append(current)

    chunks: list[Chunk] = []
    for ordinal, group in enumerate(groups):
        body = "\n\n".join(group)
        objects: list[str] = []
        for match in _SQL_OBJECT_RE.finditer(body):
            label = f"{match.group(1).upper()} {match.group(2).strip('\"`[]')}"
            if label not in objects:
                objects.append(label)
        context = " · ".join(objects)
        content = f"-- {context}\n\n{body}" if context else body
        chunks.append(
            Chunk(
                content=content,
                ordinal=ordinal,
                context=context,
                token_count=estimate_tokens(content),
                metadata={
                    **base_metadata,
                    "sql_objects": objects,
                    "statement_count": len(group),
                },
            )
        )
    return chunks


_SQL_TYPES = {"text/sql", "application/sql", "text/x-sql"}


def chunk_text(
    text: str, *, content_type: str = "text/markdown", base_metadata: dict | None = None
) -> list[Chunk]:
    """Entry point used by the ingestion pipeline."""
    text = (text or "").strip()
    if not text:
        return []
    if (content_type or "").lower() in _SQL_TYPES:
        return chunk_sql(text, base_metadata=base_metadata)
    # Markdown chunking degrades gracefully on plain text (no headings found →
    # one section), so it is the default path for every other text-ish type.
    return chunk_markdown(text, base_metadata=base_metadata)
