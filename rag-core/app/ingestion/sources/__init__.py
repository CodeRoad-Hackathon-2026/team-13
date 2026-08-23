"""Pull-based source connectors.

A source is a feed the scheduler polls on an interval. Every connector is the
same shape — ``(collection, config, cursor) -> SourceRun`` — so adding a vendor
is one function plus one registry entry, and the incremental behaviour (only
fetch what changed) is expressed once, as a cursor the connector owns.

Secrets never live in ``config`` as plaintext. A value written as ``${NAME}``
is resolved at poll time from the encrypted vault first (``app.vault``) and
from the worker's environment second, so a token is never stored readable in
Postgres and never comes back out of ``GET /v1/sources``.
"""

from __future__ import annotations

import fnmatch
import logging
import os
import pathlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any, Awaitable, Callable, Mapping

from app.ingestion.pipeline import DocumentInput

logger = logging.getLogger(__name__)

TEXT_SUFFIXES = {
    ".md", ".markdown", ".txt", ".rst", ".sql", ".json", ".yaml", ".yml",
    ".log", ".py", ".ts", ".tf", ".sh", ".ini", ".toml", ".cfg",
}

_ENV_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


@dataclass
class SourceRun:
    documents: list[DocumentInput] = field(default_factory=list)
    cursor: dict = field(default_factory=dict)


class MissingSecret(RuntimeError):
    """A ``${VAR}`` placeholder in a source config has no value in the env."""


# --------------------------------------------------------------- secrets
def resolve_secrets(value: Any, vault: Mapping[str, str] | None = None) -> Any:
    """Expand ``${NAME}`` placeholders anywhere in a config tree.

    Resolution order is vault, then environment. The vault wins so that pasting
    a token in the UI overrides a stale one baked into the worker's ``.env`` —
    the alternative would be a UI that appears to save and changes nothing.

    Fails loudly on a missing name: a connector that silently polls with an
    empty token produces confusing 401s deep in a vendor client instead of a
    clear configuration error at the top of the run.
    """
    if isinstance(value, str):
        def replace(match: re.Match[str]) -> str:
            name = match.group(1)
            if vault is not None and name in vault:
                return vault[name]
            if name in os.environ:
                return os.environ[name]
            raise MissingSecret(
                f"source config references ${{{name}}}, which is neither stored "
                f"in the secret vault nor set in the worker environment"
            )

        return _ENV_RE.sub(replace, value)
    if isinstance(value, dict):
        return {k: resolve_secrets(v, vault) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_secrets(v, vault) for v in value]
    return value


# ---------------------------------------------------------------- helpers
def matches(rel: str, patterns: list[str]) -> bool:
    """Glob matching with the ``**/`` idiom users actually expect.

    ``fnmatch`` has no recursive-wildcard concept: it expands ``**`` to ``*``
    and still requires the literal ``/``, so ``**/*.md`` silently skips every
    file at the root of the tree — the source appears to work and indexes
    nothing. Match the full relative path, the path with a leading ``**/``
    stripped, and the bare filename.
    """
    name = pathlib.PurePath(rel).name
    for pattern in patterns:
        if fnmatch.fnmatch(rel, pattern):
            return True
        if pattern.startswith("**/") and fnmatch.fnmatch(rel, pattern[3:]):
            return True
        if fnmatch.fnmatch(name, pattern):
            return True
    return False


def pluck(payload: Any, path: str | None, default: Any = None) -> Any:
    """Resolve a dotted path (``fields.summary``) inside a JSON object."""
    if not path:
        return default
    current = payload
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return default
    return current


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        # Slack uses float epoch seconds; CloudWatch uses epoch milliseconds.
        seconds = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    text = str(value)
    if text.replace(".", "", 1).isdigit():
        return parse_dt(float(text))
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class _TextExtractor(HTMLParser):
    """Minimal HTML → text, so Confluence/Jira bodies need no extra dependency."""

    _BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")
        elif tag in ("h1", "h2", "h3"):
            self.parts.append("\n## ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self._skip:
            self._skip -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html or "")
    text = "".join(parser.parts)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def adf_to_text(node: Any) -> str:
    """Flatten Atlassian Document Format (Jira Cloud v3 rich text) to plain text.

    Jira returns descriptions either as a plain string (v2) or as an ADF tree
    (v3); handling both keeps one connector working against either deployment.
    """
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(adf_to_text(child) for child in node)
    if not isinstance(node, dict):
        return str(node)

    kind = node.get("type")
    if kind == "text":
        return node.get("text", "")
    if kind == "hardBreak":
        return "\n"
    inner = adf_to_text(node.get("content"))
    if kind in ("paragraph", "heading", "listItem", "codeBlock", "blockquote"):
        return inner + "\n\n" if inner else ""
    if kind in ("bulletList", "orderedList"):
        return inner
    return inner


# --------------------------------------------------------------- registry
SourceRunner = Callable[[str, dict, dict], Awaitable[SourceRun]]
SOURCE_RUNNERS: dict[str, SourceRunner] = {}
SOURCE_SPECS: dict[str, "ConnectorSpec"] = {}
SOURCE_CHECKS: dict[str, Callable[[dict], Awaitable["CheckResult"]]] = {}


@dataclass(frozen=True)
class Field:
    """One config key, described well enough for a UI to render an input.

    This exists so the setup screen does not hardcode a form per connector.
    Adding a connector adds its form; there is no second place to edit, and no
    way for the form and the code that reads the config to drift apart.
    """

    name: str
    label: str
    # text | secret | number | boolean | textarea | list | keyvalue | select
    type: str = "text"
    required: bool = False
    default: Any = None
    help: str = ""
    placeholder: str = ""
    options: tuple[str, ...] = ()
    advanced: bool = False

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "type": self.type,
            "required": self.required,
            "default": self.default,
            "help": self.help,
            "placeholder": self.placeholder,
            "options": list(self.options),
            "advanced": self.advanced,
        }


@dataclass(frozen=True)
class ConnectorSpec:
    name: str
    label: str
    description: str
    fields: tuple[Field, ...] = ()
    docs: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "docs": self.docs,
            "fields": [f.to_dict() for f in self.fields],
            "testable": self.name in SOURCE_CHECKS,
        }


@dataclass
class CheckResult:
    ok: bool
    message: str
    detail: dict = field(default_factory=dict)


def register(
    name: str,
    *,
    label: str,
    description: str,
    fields: tuple[Field, ...] = (),
    docs: str = "",
) -> Callable[[SourceRunner], SourceRunner]:
    def decorator(func: SourceRunner) -> SourceRunner:
        SOURCE_RUNNERS[name] = func
        SOURCE_SPECS[name] = ConnectorSpec(
            name=name, label=label, description=description, fields=fields, docs=docs
        )
        return func

    return decorator


def check(name: str) -> Callable[[Any], Any]:
    """Register a cheap liveness probe for a connector.

    A connector without one still gets the generic checks in ``run_check``;
    this adds the vendor round trip that turns "saved" into "actually works".
    """

    def decorator(func: Any) -> Any:
        SOURCE_CHECKS[name] = func
        return func

    return decorator


# Importing each module populates the registries via @register / @check.
from app.ingestion.sources import (  # noqa: E402,F401
    aws_logs,
    confluence,
    filesystem,
    git_repo,
    http_json,
    jira,
    mcp_source,
    slack,
)

SOURCE_TYPES = tuple(sorted(SOURCE_RUNNERS))


def spec_for(source_type: str) -> ConnectorSpec | None:
    return SOURCE_SPECS.get(source_type)


async def run_source(
    source_type: str,
    collection: str,
    config: dict,
    cursor: dict,
    vault: Mapping[str, str] | None = None,
) -> SourceRun:
    runner = SOURCE_RUNNERS.get(source_type)
    if runner is None:
        raise ValueError(
            f"unknown source type '{source_type}'; available: {list(SOURCE_TYPES)}"
        )
    return await runner(collection, resolve_secrets(config or {}, vault), cursor or {})


async def run_check(
    source_type: str, config: dict, vault: Mapping[str, str] | None = None
) -> CheckResult:
    """Validate a config before it is saved.

    Three layers, cheapest first. The first two catch what actually goes wrong
    in practice — a required field left blank, or a ``${TOKEN}`` reference to a
    secret nobody created — and they need no network at all.
    """
    spec = SOURCE_SPECS.get(source_type)
    if spec is None:
        return CheckResult(False, f"unknown source type '{source_type}'")

    missing = [
        f.label for f in spec.fields if f.required and not (config or {}).get(f.name)
    ]
    if missing:
        return CheckResult(False, f"missing required field(s): {', '.join(missing)}")

    try:
        resolved = resolve_secrets(config or {}, vault)
    except MissingSecret as exc:
        return CheckResult(False, str(exc))

    probe = SOURCE_CHECKS.get(source_type)
    if probe is None:
        return CheckResult(
            True,
            "config is valid and every referenced secret resolves. "
            "This connector has no live probe, so credentials are verified on the first sync.",
        )
    try:
        return await probe(resolved)
    except Exception as exc:  # noqa: BLE001
        return CheckResult(False, f"{type(exc).__name__}: {exc}")
