"""Running git as a subprocess, safely.

An outbound integration like `rag_client`, not a registry entry — it happens to
speak git instead of HTTP.

Two things here are deliberate corrections of the reference implementation in RAG
Core (`app/ingestion/sources/git_repo.py`):

- That module passes ``env={"GIT_TERMINAL_PROMPT": "0", "PATH": ...}``. A
  dict-literal `env` *replaces* the environment, so the child has no HOME and no
  SSH_AUTH_SOCK — which is why its documented "SSH URLs work if the worker has a
  key mounted" cannot actually be true. Here the environment is inherited and
  then overridden, and GIT_SSH_COMMAND names the key outright so nothing depends
  on HOME being right.
- A timeout there would cancel ``communicate()`` and leave an orphaned ``git``
  running. Here the process is killed explicitly.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shlex
from dataclasses import dataclass
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

# Strips a token or password out of anything before it reaches a log or a
# database column. Matches the userinfo portion of a URL.
_USERINFO = re.compile(r"//[^/@\s]+@")


class GitError(RuntimeError):
    """A git command failed. Carries the redacted command and git's own stderr."""

    def __init__(self, command: str, stderr: str) -> None:
        super().__init__(f"{command} failed: {stderr[:500]}")
        self.command = command
        self.stderr = stderr


@dataclass
class GitOutput:
    ok: bool
    stdout: str
    stderr: str
    command: str


def redact(text: str) -> str:
    return _USERINFO.sub("//***@", text or "")


def ssh_command() -> str:
    """How git should invoke ssh.

    BatchMode so a passphrase prompt can never hang the process — the deploy key
    must be passphraseless. IdentitiesOnly so ssh does not wander through other
    keys and get rejected for offering too many.

    StrictHostKeyChecking stays on: turning it off would make the first
    connection a trust-anything window on the channel that carries your code.
    """
    parts = [
        "ssh",
        "-i", settings.change_delivery_ssh_key_path,
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", f"UserKnownHostsFile={settings.change_delivery_known_hosts}",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
    ]
    return " ".join(shlex.quote(part) for part in parts)


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_SSH_COMMAND"] = ssh_command()
    return env


async def run_git(
    *args: str, cwd: Path | None = None, timeout: float | None = None, check: bool = True
) -> GitOutput:
    """Run one git command. Arguments are an argv list — never a shell string."""
    command = redact("git " + " ".join(args))
    try:
        process = await asyncio.create_subprocess_exec(
            "git", *args,
            cwd=str(cwd) if cwd else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_env(),
        )
    except FileNotFoundError as exc:
        raise GitError(command, "git is not installed in this image") from exc

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout=timeout or settings.git_timeout_seconds
        )
    except TimeoutError:
        # wait_for cancels the coroutine; without this the process survives it.
        process.kill()
        await process.wait()
        raise GitError(command, f"timed out after {timeout or settings.git_timeout_seconds:.0f}s")

    out = GitOutput(
        ok=process.returncode == 0,
        stdout=stdout.decode(errors="replace"),
        stderr=redact(stderr.decode(errors="replace")),
        command=command,
    )
    if check and not out.ok:
        raise GitError(command, out.stderr)
    return out
