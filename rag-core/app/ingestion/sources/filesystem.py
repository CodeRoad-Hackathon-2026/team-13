"""Filesystem connector — a mounted directory of runbooks, exports or dumps."""

from __future__ import annotations

import logging
import pathlib
from datetime import datetime, timezone

from app.ingestion.pipeline import DocumentInput
from app.ingestion.sources import (
    TEXT_SUFFIXES,
    CheckResult,
    Field,
    SourceRun,
    check,
    matches,
    register,
)

logger = logging.getLogger(__name__)


@check("filesystem")
async def check_filesystem(config: dict) -> CheckResult:
    """Resolve the path and count what the globs actually match.

    Two failures hide here and both look identical from the outside — a healthy
    source that indexes nothing. The path is a host path that was never mounted
    into the worker, or the include globs match no file in it.
    """
    root = pathlib.Path(config["path"]).expanduser()
    if not root.exists():
        return CheckResult(
            False,
            f"'{root}' does not exist inside the worker container. A host "
            f"directory has to be mounted into it in docker-compose.yml first.",
        )
    if not root.is_dir():
        return CheckResult(False, f"'{root}' is not a directory")

    include = config.get("include") or ["**/*"]
    exclude = config.get("exclude") or []
    suffixes = {s.lower() for s in config.get("suffixes", TEXT_SUFFIXES)}
    hits = 0
    sample: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = str(path.relative_to(root))
        if not matches(rel, include) or (exclude and matches(rel, exclude)):
            continue
        if path.suffix.lower() not in suffixes:
            continue
        hits += 1
        if len(sample) < 5:
            sample.append(rel)

    if hits == 0:
        return CheckResult(
            False,
            f"'{root}' is readable but no file matches {include} with an allowed extension",
        )
    return CheckResult(True, f"{hits} file(s) match, e.g. {', '.join(sample)}", {"count": hits})


@register(
    "filesystem",
    label="Filesystem",
    description=(
        "Index a directory the worker can read. The path is resolved inside the "
        "worker container, so a host directory has to be mounted into it first."
    ),
    docs="docs/sources.md#filesystem",
    fields=(
        Field(
            "path",
            "Directory",
            required=True,
            placeholder="/data/runbooks",
            help="Absolute path inside the worker container, not on your laptop.",
        ),
        Field(
            "include",
            "Include globs",
            type="list",
            default=["**/*"],
            help="`**/*.md` also matches files at the root — the recursive prefix is handled.",
        ),
        Field("exclude", "Exclude globs", type="list", default=[], advanced=True),
        Field(
            "suffixes",
            "Allowed extensions",
            type="list",
            advanced=True,
            help="Defaults to the known text extensions. Binary files are skipped regardless.",
        ),
        Field(
            "metadata",
            "Extra metadata",
            type="keyvalue",
            advanced=True,
            help="Merged into every document, so it can be used as a search filter.",
        ),
    ),
)
async def run_filesystem_source(
    collection: str, config: dict, cursor: dict
) -> SourceRun:
    """config: path, include[], exclude[], metadata{}, suffixes[]"""
    root = pathlib.Path(config["path"]).expanduser()
    if not root.exists():
        raise FileNotFoundError(f"source path does not exist: {root}")

    include = config.get("include", ["**/*"])
    exclude = config.get("exclude", [])
    metadata = config.get("metadata", {})
    suffixes = {s.lower() for s in config.get("suffixes", TEXT_SUFFIXES)}

    # Only re-read files modified since the last successful poll.
    since = float(cursor.get("mtime", 0))
    newest = since

    documents: list[DocumentInput] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in suffixes:
            continue
        rel = str(path.relative_to(root))
        if not matches(rel, include):
            continue
        if exclude and matches(rel, exclude):
            continue

        mtime = path.stat().st_mtime
        newest = max(newest, mtime)
        if mtime <= since:
            continue

        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            logger.warning("unreadable file skipped: %s", path)
            continue

        documents.append(
            DocumentInput(
                collection=collection,
                external_id=rel,
                content=content,
                title=path.stem.replace("-", " ").replace("_", " "),
                uri=str(path),
                source_type="filesystem",
                content_type=f"text/{path.suffix.lstrip('.') or 'plain'}",
                metadata={**metadata, "path": rel, "extension": path.suffix.lstrip(".")},
                source_updated_at=datetime.fromtimestamp(mtime, tz=timezone.utc),
            )
        )

    return SourceRun(documents=documents, cursor={"mtime": newest})
