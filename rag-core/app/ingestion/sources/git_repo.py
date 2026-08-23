"""Git repository connector — SQL, migrations, IaC, docs kept in version control.

Incremental sync uses the commit SHA rather than file mtimes: a fresh clone
rewrites every mtime, so an mtime cursor would re-embed the whole repository on
any runner that starts from a clean checkout. With a SHA cursor, a poll after
the first one re-embeds exactly the files that appear in
``git diff --name-status <old>..<new>`` — and deletions actually remove the
document instead of leaving a stale one in the index.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import pathlib
import shutil
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse

from app.ingestion.pipeline import DocumentInput, delete_document
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

CACHE_ROOT = pathlib.Path("/tmp/rag-repos")


class GitError(RuntimeError):
    pass


async def _git(*args: str, cwd: pathlib.Path | None = None) -> str:
    process = await asyncio.create_subprocess_exec(
        "git", *args,
        cwd=str(cwd) if cwd else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        # Never let git block the worker waiting for a passphrase prompt.
        env={"GIT_TERMINAL_PROMPT": "0", "PATH": "/usr/bin:/bin:/usr/local/bin"},
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        raise GitError(
            f"git {' '.join(args[:2])} failed: {stderr.decode(errors='replace')[:500]}"
        )
    return stdout.decode(errors="replace")


def _authenticated_url(url: str, token: str | None) -> str:
    """Inject a token into an https clone URL without logging it."""
    if not token or not url.startswith("http"):
        return url
    parsed = urlparse(url)
    netloc = f"x-access-token:{token}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


def _redact(url: str) -> str:
    parsed = urlparse(url)
    if parsed.password or "@" in (parsed.netloc or ""):
        return urlunparse(parsed._replace(netloc=parsed.hostname or ""))
    return url


async def _ensure_checkout(url: str, branch: str, workdir: pathlib.Path) -> None:
    if (workdir / ".git").exists():
        await _git("remote", "set-url", "origin", url, cwd=workdir)
        await _git("fetch", "--depth", "1", "origin", branch, cwd=workdir)
        await _git("reset", "--hard", f"origin/{branch}", cwd=workdir)
        await _git("clean", "-fd", cwd=workdir)
        return
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)
    workdir.parent.mkdir(parents=True, exist_ok=True)
    await _git("clone", "--depth", "1", "--branch", branch, url, str(workdir))


async def _changed_files(workdir: pathlib.Path, old_sha: str) -> tuple[list[str], list[str]] | None:
    """Return (changed, deleted) between old_sha and HEAD, or None if unknown.

    A shallow clone usually lacks the old commit; deepening is cheaper than
    re-embedding the whole repository, but if it still fails we fall back to a
    full walk.
    """
    try:
        await _git("cat-file", "-e", f"{old_sha}^{{commit}}", cwd=workdir)
    except GitError:
        try:
            await _git("fetch", "--depth", "50", "origin", cwd=workdir)
            await _git("cat-file", "-e", f"{old_sha}^{{commit}}", cwd=workdir)
        except GitError:
            return None

    output = await _git("diff", "--name-status", f"{old_sha}..HEAD", cwd=workdir)
    changed, deleted = [], []
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status, path = parts[0], parts[-1]
        (deleted if status.startswith("D") else changed).append(path)
    return changed, deleted


@check("git_repo")
async def check_git_repo(config: dict) -> CheckResult:
    """`git ls-remote` verifies the URL, the token and the branch without cloning.

    Cloning to validate would take minutes on a large repo and fill the cache
    with a checkout the user may be about to discard.
    """
    url = _authenticated_url(config["url"], config.get("token"))
    branch = config.get("branch", "main")
    try:
        output = await _git("ls-remote", "--heads", url, branch)
    except GitError as exc:
        # The error text can contain the injected token.
        return CheckResult(False, str(exc).replace(config.get("token") or "\0", "***")[:400])
    if not output.strip():
        heads = await _git("ls-remote", "--heads", url)
        names = [line.split("refs/heads/")[-1] for line in heads.splitlines() if "refs/heads/" in line]
        return CheckResult(
            False,
            f"repository is reachable but has no branch '{branch}'. "
            f"Branches: {', '.join(names[:10]) or '(none)'}",
            {"branches": names[:20]},
        )
    return CheckResult(
        True, f"'{branch}' resolves to {output.split()[0][:12]}", {"sha": output.split()[0]}
    )


@register(
    "git_repo",
    label="Git repository",
    description=(
        "Clones once, then diffs by commit SHA. Written for repositories of SQL "
        "and markdown: .sql files are split by statement, not by token window."
    ),
    docs="docs/sources.md#git_repo",
    fields=(
        Field(
            "url",
            "Clone URL",
            required=True,
            placeholder="https://github.com/acme/db-migrations.git",
        ),
        Field("branch", "Branch", default="main"),
        Field(
            "token",
            "Access token",
            type="secret",
            placeholder="${GITHUB_TOKEN}",
            help="Only needed for private HTTPS clones. Injected into the URL, never logged.",
        ),
        Field(
            "include",
            "Include globs",
            type="list",
            default=["**/*.sql", "**/*.md"],
        ),
        Field(
            "exclude",
            "Exclude globs",
            type="list",
            default=["**/.git/**", "**/node_modules/**", "**/vendor/**"],
            advanced=True,
        ),
        Field("suffixes", "Allowed extensions", type="list", advanced=True),
        Field("max_file_kb", "Max file size (KB)", type="number", default=512, advanced=True),
        Field("metadata", "Extra metadata", type="keyvalue", advanced=True),
    ),
)
async def run_git_repo_source(collection: str, config: dict, cursor: dict) -> SourceRun:
    """config:
      url          — https://github.com/org/repo.git (or ssh)
      branch       — default "main"
      token        — "${GITHUB_TOKEN}" for private https clones
      include[]    — e.g. ["**/*.sql", "docs/**/*.md"]
      exclude[]    — e.g. ["**/node_modules/**"]
      suffixes[]   — override the default text-file suffix allowlist
      max_file_kb  — skip files larger than this (default 512)
      metadata{}
    """
    url = config["url"]
    branch = config.get("branch", "main")
    include = config.get("include", ["**/*.sql", "**/*.md"])
    exclude = config.get("exclude", ["**/.git/**", "**/node_modules/**", "**/vendor/**"])
    suffixes = {s.lower() for s in config.get("suffixes", TEXT_SUFFIXES)}
    max_bytes = int(config.get("max_file_kb", 512)) * 1024

    slug = hashlib.sha256(f"{url}@{branch}".encode()).hexdigest()[:16]
    workdir = CACHE_ROOT / slug

    await _ensure_checkout(_authenticated_url(url, config.get("token")), branch, workdir)
    head = (await _git("rev-parse", "HEAD", cwd=workdir)).strip()

    old_sha = cursor.get("sha")
    if old_sha == head:
        logger.info("git_repo: %s already at %s", _redact(url), head[:8])
        return SourceRun(documents=[], cursor={"sha": head})

    selected: list[str] | None = None
    if old_sha:
        diff = await _changed_files(workdir, old_sha)
        if diff is None:
            logger.info("git_repo: cannot diff from %s, walking the tree", old_sha[:8])
        else:
            changed, deleted = diff
            selected = changed
            for path in deleted:
                if matches(path, include) and (not exclude or not matches(path, exclude)):
                    await delete_document(collection, path)
            logger.info(
                "git_repo: %d changed, %d deleted since %s",
                len(changed), len(deleted), old_sha[:8],
            )

    if selected is None:
        selected = [
            str(p.relative_to(workdir))
            for p in workdir.rglob("*")
            if p.is_file() and ".git/" not in str(p.relative_to(workdir))
        ]

    repo_name = _redact(url).rstrip("/").split("/")[-1].removesuffix(".git")
    documents: list[DocumentInput] = []

    for rel in selected:
        path = workdir / rel
        if not path.is_file() or path.suffix.lower() not in suffixes:
            continue
        if not matches(rel, include) or (exclude and matches(rel, exclude)):
            continue
        if path.stat().st_size > max_bytes:
            logger.debug("git_repo: skipping oversized file %s", rel)
            continue

        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if not content.strip():
            continue

        # Last commit that touched this file — useful metadata during an
        # incident ("was this migration part of the bad deploy?").
        try:
            last_commit = (
                await _git("log", "-1", "--format=%H|%an|%aI|%s", "--", rel, cwd=workdir)
            ).strip()
        except GitError:
            last_commit = ""
        sha, author, authored, subject = (last_commit.split("|", 3) + ["", "", "", ""])[:4]

        documents.append(
            DocumentInput(
                collection=collection,
                external_id=rel,
                content=content,
                title=pathlib.PurePath(rel).name,
                uri=f"{_redact(url).removesuffix('.git')}/blob/{branch}/{rel}",
                source_type="git_repo",
                content_type=f"text/{path.suffix.lstrip('.') or 'plain'}",
                metadata={
                    **(config.get("metadata") or {}),
                    "kind": "source_code",
                    "repo": repo_name,
                    "branch": branch,
                    "path": rel,
                    "extension": path.suffix.lstrip("."),
                    **({"last_commit": sha[:12]} if sha else {}),
                    **({"last_author": author} if author else {}),
                    **({"last_commit_subject": subject} if subject else {}),
                },
                source_updated_at=(
                    datetime.fromisoformat(authored) if authored else datetime.now(timezone.utc)
                ),
            )
        )

    logger.info("git_repo: %s -> %d documents at %s", repo_name, len(documents), head[:8])
    return SourceRun(documents=documents, cursor={"sha": head})
