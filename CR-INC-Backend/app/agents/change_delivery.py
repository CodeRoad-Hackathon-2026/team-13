"""Change Delivery Agent — takes an approved code change and delivers it.

The Decision Agent writes a diff from a runbook, not from the repository. It can
reference lines that have since moved, and until now nothing checked. This agent
clones the real code, proves the patch applies, and pushes a branch the operator
opens as a PR with one click.

When the patch does not apply it asks the model again, this time showing it the
actual file. That is why this is an agent and not a tool: it exercises judgement
and spends tokens doing it.

One thing to be clear-eyed about: **after a regeneration the diff being pushed is
not the diff the human approved.** That is only acceptable because no pull
request is opened programmatically — the compare URL puts the real change in
front of a person before anything can merge. If a token ever appears and someone
automates PR creation, this path has to be re-reviewed first.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, ClassVar

import asyncpg

from app.agents.base import Agent, AgentFailed, AgentResult
from app.agents.diff_apply import ApplyOutcome, apply_with_ladder, normalise, summarise, touched_paths
from app.agents.patch import extract_diff_block, parse_unified_diff
from app.agents.repo_target import RepoTarget, TargetRefused, check_allowed, resolve_repo, safe_branch
from app.config import settings
from app.git_ops import GitError, run_git
from app.rag_client import RagClient, RagError

logger = logging.getLogger(__name__)

# One lock per checkout directory. Correct for a single orchestrator process and
# NOT correct with more than one uvicorn worker — two processes would race the
# same directory. `git worktree` per execution is the answer if that day comes.
_locks: dict[str, asyncio.Lock] = {}

REGENERATE_PROMPT = """\
A proposed code change did not apply to the repository.

Incident: {title}
Approved change: {description}
{summary}

git refused it with:
{error}

This is the patch that failed:
{diff}

This is what the file actually contains right now, with real line numbers:
{files}

Rewrite the patch so it applies to the file as shown. Keep the intent of the
approved change exactly — do not add improvements, and do not touch any file
other than: {paths}

Reply with one unified diff in a ```diff block and nothing else.
"""


class ChangeDeliveryAgent(Agent):
    name: ClassVar[str] = "Change Delivery Agent"

    def __init__(self, action: dict[str, Any], parameters: dict[str, Any], rag: RagClient) -> None:
        self._action = action
        self._parameters = parameters
        self._rag = rag

    def describe_input(self, incident: asyncpg.Record) -> dict[str, Any]:
        return {
            "incident_id": str(incident["id"]),
            "repo": self._parameters.get("repo"),
            "branch": self._parameters.get("branch"),
        }

    async def handle(
        self, conn: asyncpg.Connection, incident: asyncpg.Record, run_id: str
    ) -> AgentResult:
        diff = normalise(str(self._parameters.get("diff") or ""))
        if not parse_unified_diff(diff)["files"]:
            return _declined("this action carries no patch to deliver")

        try:
            target = self._resolve(incident, run_id)
        except TargetRefused as exc:
            # A refusal is a conclusion, not a fault: the agent did its job and
            # decided this must not be delivered.
            return _declined(str(exc))

        transcript: list[str] = []
        try:
            return await self._deliver(target, diff, incident, transcript)
        except GitError as exc:
            # Infrastructure, not judgement — git missing, remote unreachable,
            # push rejected. This is what AgentFailed is for.
            transcript.append(f"{exc.command}\n{exc.stderr}")
            raise AgentFailed(f"{exc}\n\n" + "\n".join(transcript)) from exc

    def _resolve(self, incident: asyncpg.Record, run_id: str) -> RepoTarget:
        host, slug, source_url = resolve_repo(
            incident["repository_url"], self._parameters.get("repo")
        )
        check_allowed(host, slug)
        base = str(self._parameters.get("base") or "main").strip() or "main"
        branch = safe_branch(self._parameters.get("branch"), base, run_id[:8])
        return RepoTarget(host=host, slug=slug, clone_url=source_url, base=base, branch=branch)

    async def _deliver(
        self,
        target: RepoTarget,
        diff: str,
        incident: asyncpg.Record,
        transcript: list[str],
    ) -> AgentResult:
        workdir = Path(settings.change_delivery_workdir) / _slug(target.slug)
        lock = _locks.setdefault(str(workdir), asyncio.Lock())

        async with lock:
            await self._checkout(target, workdir, transcript)
            base_sha = (await run_git("rev-parse", "HEAD", cwd=workdir)).stdout.strip()

            approved_paths = set(touched_paths(diff))
            current, outcome, regenerations = diff, None, 0

            while True:
                outcome = await self._apply(current, workdir, transcript)
                if outcome.applied or regenerations >= settings.change_delivery_max_regenerations:
                    break

                rewritten = await self._regenerate(
                    current, outcome, target, incident, approved_paths, workdir, transcript
                )
                if rewritten is None:
                    break
                current, regenerations = rewritten, regenerations + 1
                await run_git("reset", "--hard", cwd=workdir)
                await run_git("clean", "-ffdx", cwd=workdir)

            if not outcome.applied:
                return _declined(
                    f"the patch did not apply after {regenerations} regeneration(s); "
                    f"git said: {outcome.first_error}",
                    attempts=summarise(outcome),
                    logs=transcript,
                    regenerations=regenerations,
                )

            commit_sha = await self._commit(target, incident, regenerations, workdir, transcript)
            pushed = await self._push(target, workdir, transcript)

            parsed = parse_unified_diff(current)
            return AgentResult(
                output={
                    "delivered": True,
                    "pushed": pushed,
                    "dryRun": not settings.change_delivery_push_enabled,
                    "repo": target.slug,
                    "base": target.base,
                    "branch": target.branch,
                    "baseSha": base_sha,
                    "commitSha": commit_sha,
                    "compareUrl": target.compare_url if pushed else None,
                    "filesChanged": [f["path"] for f in parsed["files"]],
                    "additions": parsed["additions"],
                    "deletions": parsed["deletions"],
                    "regenerations": regenerations,
                    "applyAttempts": summarise(outcome),
                    "logs": "\n".join(transcript),
                }
            )

    async def _checkout(self, target: RepoTarget, workdir: Path, transcript: list[str]) -> None:
        """Bring the checkout to a clean copy of the base branch.

        Trusts nothing about what a previous run left behind: a patched working
        tree from a failed delivery would otherwise be the starting point.
        """
        if (workdir / ".git").exists():
            await run_git("remote", "set-url", "origin", target.clone_url, cwd=workdir)
        else:
            workdir.parent.mkdir(parents=True, exist_ok=True)
            await run_git("clone", "--depth", "1", "--branch", target.base,
                          target.clone_url, str(workdir))

        await run_git("fetch", "--depth", "1", "origin", target.base, cwd=workdir)
        await run_git("checkout", "-B", target.branch, "FETCH_HEAD", cwd=workdir)
        await run_git("reset", "--hard", cwd=workdir)
        await run_git("clean", "-ffdx", cwd=workdir)
        transcript.append(f"checked out {target.slug}@{target.base} as {target.branch}")

    async def _apply(self, diff: str, workdir: Path, transcript: list[str]) -> ApplyOutcome:
        patch = workdir / ".delivery.patch"
        patch.write_text(diff, encoding="utf-8")

        async def run(flags: list[str]) -> tuple[bool, str]:
            out = await run_git("apply", *flags, str(patch), cwd=workdir, check=False)
            transcript.append(f"{out.command} -> {'ok' if out.ok else out.stderr.strip()}")
            return out.ok, out.stderr

        outcome = await apply_with_ladder(diff, run)
        patch.unlink(missing_ok=True)
        return outcome

    async def _regenerate(
        self,
        diff: str,
        outcome: ApplyOutcome,
        target: RepoTarget,
        incident: asyncpg.Record,
        approved_paths: set[str],
        workdir: Path,
        transcript: list[str],
    ) -> str | None:
        prompt = REGENERATE_PROMPT.format(
            title=incident["title"],
            description=self._action.get("description") or "",
            summary=self._parameters.get("summary") or "",
            error=outcome.first_error or "(no message)",
            diff=diff,
            files=_render_files(workdir, diff),
            paths=", ".join(sorted(approved_paths)),
        )

        try:
            response = await self._rag.answer(prompt, incident_id=str(incident["id"]))
        except RagError as exc:
            transcript.append(f"regeneration unavailable: {exc}")
            return None

        if response.get("abstained"):
            transcript.append(f"regeneration declined: {response.get('abstain_reason')}")
            return None

        rewritten = extract_diff_block(response.get("answer") or "")
        if rewritten is None:
            transcript.append("regeneration returned prose, not a diff")
            return None

        rewritten = normalise(rewritten)
        parsed = parse_unified_diff(rewritten)
        if not parsed["files"]:
            transcript.append("regeneration produced an unreadable diff")
            return None

        # The guardrail that matters most. A rewrite touching a file the human
        # never saw has drifted from what was approved, however good it looks.
        strayed = {f["path"] for f in parsed["files"]} - approved_paths
        if strayed:
            transcript.append(f"regeneration rejected: it reached outside the approved files {sorted(strayed)}")
            return None

        transcript.append(f"regenerated the patch ({parsed['additions']}+/{parsed['deletions']}-)")
        return rewritten

    async def _commit(
        self,
        target: RepoTarget,
        incident: asyncpg.Record,
        regenerations: int,
        workdir: Path,
        transcript: list[str],
    ) -> str:
        body = [
            "",
            f"Incident: {incident['external_id'] or incident['id']}",
            f"Proposed by the orchestrator and approved by a human.",
        ]
        if regenerations:
            # Recorded in the commit itself, because this is the fact a reviewer
            # most needs and would otherwise never learn.
            body.append(
                f"The patch was regenerated {regenerations} time(s) to apply to current HEAD, "
                "so it differs from the diff that was approved."
            )
        message = (self._action.get("description") or "Apply proposed remediation")[:72] + "\n" + "\n".join(body)

        await run_git("add", "-A", cwd=workdir)
        await run_git(
            "-c", "user.name=Incident Orchestrator",
            "-c", "user.email=orchestrator@localhost",
            "-c", "commit.gpgsign=false",
            "commit", "-m", message, cwd=workdir,
        )
        sha = (await run_git("rev-parse", "HEAD", cwd=workdir)).stdout.strip()
        transcript.append(f"committed {sha[:12]}")
        return sha

    async def _push(self, target: RepoTarget, workdir: Path, transcript: list[str]) -> bool:
        if not settings.change_delivery_push_enabled:
            transcript.append("push disabled — the commit exists locally only")
            return False
        # No --force, ever. If the branch is already out there, that is someone
        # else's work and this must not land on top of it.
        await run_git("push", "origin", target.branch, cwd=workdir, timeout=60)
        transcript.append(f"pushed {target.branch}")
        return True


def _declined(reason: str, **extra: Any) -> AgentResult:
    """A conclusion, not a fault — SUCCESS on the run, with a negative result."""
    return AgentResult(output={"delivered": False, "reason": reason, **extra})


def _slug(repo: str) -> str:
    return repo.replace("/", "__").replace(":", "_")


def _render_files(workdir: Path, diff: str) -> str:
    """The real file around each hunk, numbered.

    The numbering is the point: it is what lets the model write a correct @@
    header instead of guessing at one again.
    """
    blocks: list[str] = []
    for file in parse_unified_diff(diff)["files"]:
        path = workdir / file["path"]
        if not path.is_file():
            blocks.append(f"### {file['path']}\n(this file does not exist in the repository)")
            continue

        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        starts = [line["old"] for hunk in file["hunks"] for line in hunk["lines"] if line["old"]]
        window = settings.change_delivery_context_lines
        low = max(0, min(starts, default=1) - window)
        high = min(len(lines), max(starts, default=len(lines)) + window)
        body = "\n".join(f"{n:5d}| {lines[n - 1]}" for n in range(low + 1, high + 1))
        blocks.append(f"### {file['path']}\n{body}")
    return "\n\n".join(blocks)
