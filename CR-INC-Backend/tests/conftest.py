"""A real git repository to deliver into.

Pushing to GitHub differs from pushing to a `file://` remote only in the URL, so
a bare repo on disk exercises the whole chain — clone, apply, commit, push — with
no network and no credentials.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

PGBOUNCER = """resource "aws_db_proxy" "payments" {
  name = "payments-db-primary"
  max_connections_percent      = 60
  max_idle_connections_percent = 20
}
"""

needs_git = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")


def git(*args: str, cwd: Path) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout


@pytest.fixture
def origin(tmp_path: Path) -> str:
    """A bare repo holding one commit, returned as a file:// URL."""
    bare = tmp_path / "origin.git"
    work = tmp_path / "seed"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(bare)], check=True, capture_output=True)

    work.mkdir()
    git("init", "-b", "main", cwd=work)
    git("config", "user.email", "seed@localhost", cwd=work)
    git("config", "user.name", "Seed", cwd=work)
    (work / "infra").mkdir()
    (work / "infra" / "pgbouncer.tf").write_text(PGBOUNCER)
    git("add", "-A", cwd=work)
    git("commit", "-m", "initial", cwd=work)
    git("remote", "add", "origin", str(bare), cwd=work)
    git("push", "origin", "main", cwd=work)

    return f"file://{bare}"


@pytest.fixture
def remote_branches():
    def read(origin_url: str) -> list[str]:
        out = subprocess.run(
            ["git", "ls-remote", "--heads", origin_url],
            check=True, capture_output=True, text=True,
        ).stdout
        return [line.split("refs/heads/")[-1] for line in out.splitlines() if line.strip()]

    return read
