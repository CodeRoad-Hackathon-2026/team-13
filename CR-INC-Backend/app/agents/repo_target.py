"""Deciding which repository and branch a change may touch.

Both strings reach a git command line, and both originate — at least partly — in
a language model's output. This module is where that stops being taken on trust.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

from app.config import settings

BRANCH_ALLOWED = re.compile(r"^[A-Za-z0-9._/-]+$")
PROTECTED = {"main", "master", "trunk", "develop", "head"}


class TargetRefused(ValueError):
    """The target could not be trusted. The message is shown to the operator."""


@dataclass
class RepoTarget:
    host: str
    slug: str          # org/repo
    clone_url: str     # what git is actually given
    base: str
    branch: str

    @property
    def compare_url(self) -> str | None:
        """The page that opens a PR pre-filled, or None off GitHub.

        Three dots is the merge-base diff — what the PR will actually show. For
        any other host, including the file:// remote the tests use, this returns
        None rather than fabricating a github.com link for a repository that
        does not live there.
        """
        if self.host != "github.com":
            return None
        return f"https://github.com/{self.slug}/compare/{self.base}...{self.branch}?expand=1"


def parse_repo(url: str) -> tuple[str, str]:
    """(host, org/repo) from an ssh, https or file URL."""
    text = (url or "").strip()
    if not text:
        raise TargetRefused("no repository URL")

    if text.startswith("file://") or text.startswith("/"):
        return "", text.removeprefix("file://").rstrip("/")

    if text.startswith("git@") or (":" in text and "//" not in text):
        host, _, path = text.partition(":")
        host = host.rpartition("@")[2]
    else:
        parsed = urlparse(text)
        host, path = parsed.hostname or "", parsed.path

    slug = path.strip("/").removesuffix(".git")
    if slug.count("/") != 1:
        raise TargetRefused(f"{url!r} is not an org/repo URL")
    return host.lower(), slug


def resolve_repo(service_url: str | None, planner_repo: str | None) -> tuple[str, str, str]:
    """Settle on a repository, refusing rather than guessing.

    `services.repository_url` is the source of truth; the planner's `repo` is a
    claim to be checked against it. On disagreement this refuses instead of
    preferring one, because a mismatch means either the planner picked the wrong
    repository or the incident is attributed to the wrong service — and a human
    needs to see which.
    """
    service = parse_repo(service_url) if service_url else None
    planner = parse_repo(planner_repo) if planner_repo else None

    if service and planner and service[1].lower() != planner[1].lower():
        raise TargetRefused(
            f"the service is registered as {service[1]} but the planner proposed "
            f"{planner[1]} — refusing until they agree"
        )

    chosen = service or planner
    if chosen is None:
        raise TargetRefused(
            "neither the service nor the action names a repository"
        )

    host, slug = chosen
    source = service_url if service else planner_repo
    return host, slug, (source or "")


def check_allowed(host: str, slug: str) -> None:
    """Deny by default, like execution_allowed_hosts does for the HTTP tool."""
    if not settings.change_delivery_allowed_repos:
        raise TargetRefused(
            "no repository is allowed for delivery; add one to "
            "CHANGE_DELIVERY_ALLOWED_REPOS before this action can run"
        )
    if slug.lower() not in {r.lower() for r in settings.change_delivery_allowed_repos}:
        raise TargetRefused(
            f"{slug} is not in CHANGE_DELIVERY_ALLOWED_REPOS; add it deliberately"
        )
    # A local path has no host and is only reachable in tests.
    if host and host not in settings.change_delivery_allowed_hosts:
        raise TargetRefused(f"host {host!r} is not in CHANGE_DELIVERY_ALLOWED_HOSTS")


def safe_branch(proposed: str | None, base: str, suffix: str) -> str:
    """Turn the planner's branch string into one that is safe on a command line.

    A branch name reaches git as an argument, so a leading dash would read as a
    flag and `..` is a revision range. The prefix is forced so every branch this
    system creates is identifiable as machine-authored.
    """
    name = (proposed or "").strip().strip("/")
    prefix = settings.change_delivery_branch_prefix

    if name and (not BRANCH_ALLOWED.match(name) or ".." in name or name.startswith("-") or "@{" in name):
        name = ""

    # Checked against the name *without* the prefix, and before it is forced.
    # Prefixing first would turn "main" into "remediate/main" and quietly let it
    # through — the guard would defeat itself. Refusing instead of rewriting also
    # surfaces that the planner meant to write to a protected branch.
    bare = name.removeprefix(prefix).strip("/")
    if bare and (bare.lower() in PROTECTED or bare.lower() == base.lower()):
        raise TargetRefused(f"refusing to deliver onto {bare!r}")

    if not name:
        name = f"{prefix}{suffix}"
    if not name.startswith(prefix):
        name = f"{prefix}{name.lstrip('/')}"
    return name[:200]
