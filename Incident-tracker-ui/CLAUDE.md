<!-- SPECKIT START -->
Active plan: `specs/001-incident-response-dashboard/plan.md` (branch `001-incident-response-dashboard`).
For technologies, project structure, and other implementation context, read that plan and its
`research.md`, `data-model.md`, `component-inventory.md`, and `contracts/*.md` alongside it.
<!-- SPECKIT END -->

# Incident-tracker-ui

Frontend for the **AI Incident Response Orchestrator** dashboard (MVP / hackathon). Parent
workspace guidance also applies (`../../CLAUDE.md`, `../CLAUDE.md`).

## Current state — Phase 1 (Setup) complete, PRD v2.0 in effect

`npm install`/`dev`/`build`/`test`/`test:e2e`/`typecheck`/`lint` all work — see `tasks.md`, Phase 1.
No feature-specific code exists yet (Foundational and every user story are still pending).

| Path | What it is |
|---|---|
| `docs/ui_prd_incident_orchestrator_dashboard (1).md` | **The authoritative spec — v2.0.** Persistent alert strip + three tabs (Now/Performance/Knowledge), replacing v1.0's two stacked bands. Numbered requirements (`AS-*`, `TB-*`, `XT-*`, `FI-*`, `K1-4`, `AR-*`, `IT-*`, `EO-*`, `TL-*`, `X-*`, `A11Y-*`, `P-*`), the API surface (§9), acceptance criteria (§11, now 20 items), and build order (§12). |
| `docs/incident_dashboard_prototype (1).html` | v2.0 wireframe. Visual reference only — not extended as application code (constitution, Technology Constraints). Its demo JS has known drift from the PRD's own prose on funnel-click semantics (spec.md Assumption 13); the PRD prose governs. |
| `docs/ui_prd_incident_orchestrator_dashboard.md`, `docs/incident_dashboard_prototype.html` | **v1.0 — superseded, kept for history only.** Do not implement against these; `specs/001-incident-response-dashboard/spec.md` was fully re-spec'd against v2.0 in place, under the same feature. |
| `.specify/`, `.claude/skills/` | Spec Kit 0.8.6 scaffolding (see below). |

The stack is fixed by the constitution: **React + TypeScript (strict), functional components,
React Hook Form, React Testing Library**, layered `src/components/` · `src/domain/` · `src/api/`
· `src/state/` (URL/operator/tab state). Libraries below that line, decided in
`specs/001-incident-response-dashboard/plan.md` and `research.md`: **Vite** (build), **no
router** — a hand-rolled `useUrlState` hook now also carrying the active tab, and hand-rolled ARIA
tabs (research.md §11, added for v2.0) rather than a router or a tabs library, **TanStack Query**
(server state — also why Performance/Knowledge panels keep polling while not the visible tab, for
free, since nothing unmounts on a tab switch), **Recharts** + a hand-rolled funnel (charts), **sql-formatter**
+ a hand-rolled tokenizer (safe SQL/JSON rendering), **Vitest** (unit/component), **Playwright**
(e2e), **MSW** (mocked HTTP boundary for both dev-without-backend and tests). See
`.specify/memory/constitution.md` → "Technology and Architecture Constraints" for what's fixed vs.
what was the plan's to decide.

A project-local `.npmrc` pins this repo to the public npm registry (`registry.npmjs.org`),
overriding the global Cox Artifactory config for installs run from inside this directory only —
added because the global Artifactory auth was expired/broken when Phase 1 was built. It's committed,
so cloning this repo elsewhere gets the same override; revisit if that's not the intended policy.

The PRD declares `Depends on: ai_incident_response_database_schema.md`, which is **not in this
repo**. Table/column names in the PRD (`incidents`, `recommended_actions`, `executed_actions`,
`agent_runs`, `similarity_matches`, `incident_events`, `developer_feedback`, plus v2.0's new
`knowledge_embeddings`) come from there — treat them as given and don't invent adjacent ones.

## Spec Kit workflow

This repo drives work through Spec Kit (sequential branch numbering, `sh` scripts, `claude`
integration). Skills live in `.claude/skills/` and are invoked as `/speckit.*`:

```
/speckit.constitution → /speckit.specify → /speckit.clarify → /speckit.plan
  → /speckit.tasks → /speckit.analyze → /speckit.implement
```

- Artifacts land in `specs/<NNN>-slug/` (`spec.md`, `plan.md`, `tasks.md`, `checklists/`).
  The feature dir is resolved from the current branch's numeric prefix, so `004-fix-bug` and
  `004-add-feature` share `specs/004-*/`. Override with `export SPECIFY_FEATURE=<branch>` when
  working off-branch.
- Helper scripts: `.specify/scripts/bash/check-prerequisites.sh --json`, `setup-plan.sh`,
  `setup-tasks.sh`, `create-new-feature.sh`. Most accept `--json` and `--paths-only`.
- `.specify/memory/constitution.md` is **ratified at v1.0.0** (2026-08-13) — 14 numbered
  principles, binding on every spec/plan/task. `/speckit.analyze` treats a violation as CRITICAL,
  and `plan.md`'s Constitution Check is a real gate with a concrete checklist. Amend only via
  `/speckit.constitution`, never by editing the file directly.
- The `git` extension hooks (`.specify/extensions.yml`) fire around every command with
  `auto_execute_hooks: true`, but `.specify/extensions/git/git-config.yml` has all `auto_commit`
  entries `false`. So in practice: `/speckit.specify` creates the feature branch; commits stay
  manual.

## Requirements that constrain implementation

Quick reference only — the binding form of these is `.specify/memory/constitution.md` and
`specs/001-incident-response-dashboard/spec.md`. They are the PRD v2.0 decisions most easily broken
by an obvious-looking implementation:

- **The alert strip is not a tab and never stops polling** — it's mounted in the header, outside
  every `TabPanel`, and keeps its own 30s cadence regardless of which tab is active (AS-1, AS-8,
  X-2, §11.11, §11.12). At zero it renders a calm message, never a blank/missing strip (AS-4,
  §11.13).
- **The approval queue is never behind a tab** — reachable from the strip's own button from any
  tab (§13 explicitly rejects "approval queue behind its own tab").
- **Resolving one approval card must never disturb a sibling's live state** — a real v1 bug the
  PRD calls out by name (§11.19). Queue re-renders MUST key cards by `id`, never array index.
- **Median, never average**, for resolution time; average goes in the tooltip (N1b).
- **`ROLLED_BACK` is its own bucket** everywhere — not a success, not a failure (EO-1).
- **Approve must be idempotent** — disable on click. A double-fired remediation Lambda is a real
  outage (X-4).
- **Row click opens the right-side drawer**, never a page navigation (IT-1). Drawer is
  deep-linkable at `/?tab=now&incident=<id>`.
- **Filters (time range / environment / service / active tab) persist in the URL query string**
  (§4, §11.7, §11.18). Filter state survives a tab switch in both directions (TB-5, §11.17).
- **A funnel-stage or breakdown click is a cross-tab jump**, not a same-page filter: switch to Now,
  apply the filter, flash the table, show a distinctly-styled chip, toast what happened (XT-1..4).
  Clearing the chip stays on Now — it never navigates back (XT-5, §11.16).
- **The alert strip and the Now tab ignore the time range**; only Performance and Knowledge are
  range-filtered.
- **JSONB fields** (`parameters`, `input`, `output`, `execution_logs`, `response_payload`) are
  fetched lazily on expand and never included in list responses (P-4).
- **Rejection reason is required** and writes both `recommended_actions.status='REJECTED'` and a
  `developer_feedback` row (AR-6).
- **The feedback-impact widget is suppressed entirely below 10 team-wide corrections** — never
  shown with a caveat — and never attributes a decline to the viewing user (FI-3, FI-4, §11.20).
  No leaderboards/streaks/badges/points anywhere (§13).
- **Colour is never the only signal** — every priority/risk/status pill carries a text label
  (AR-1, A11Y-1).
- Four distinct states per component: loading, empty-no-data, empty-filtered, error (§8, §11.8).
  Errors are per-component; a failed chart must not take down the dashboard.
- **Switching tabs never refetches or re-skeletons already-loaded content** — panels stay mounted;
  only visibility toggles (TB-4).
