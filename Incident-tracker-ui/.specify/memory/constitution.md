<!--
SYNC IMPACT REPORT — 2026-08-13
Version change: unversioned template → 1.0.0 (initial ratification)

Modified principles (template placeholder → concrete):
- [PRINCIPLE_1_NAME] → I. Contract-First Development
- [PRINCIPLE_2_NAME] → II. Traceability
- [PRINCIPLE_3_NAME] → III. Domain Logic Lives Outside the UI
- [PRINCIPLE_4_NAME] → IV. Metric Truthfulness
- [PRINCIPLE_5_NAME] → V. Irreversible Actions Are Guarded
Added principles (beyond the 5 template slots):
- VI. Human-in-the-Loop Transparency
- VII. Four States, Always
- VIII. Failure Isolation
- IX. The URL Is the Shareable State
- X. Accessibility Is a Requirement, Not Polish
- XI. Performance Budgets Are Contractual
- XII. Testability
- XIII. Least Trust in the Client
- XIV. Scope Discipline

Added sections:
- [SECTION_2_NAME] → Technology and Architecture Constraints
- [SECTION_3_NAME] → Development Workflow and Quality Gates
Removed sections: none (all template slots filled)

Templates requiring updates:
- ✅ .specify/templates/plan-template.md (Constitution Check gates made concrete)
- ✅ .specify/templates/tasks-template.md (tests no longer "OPTIONAL" — Principle XII)
- ✅ .specify/templates/spec-template.md (PRD traceability + UI-state requirements)
- ✅ CLAUDE.md (removed "constitution is an unfilled template" note; added stack)
- N/A .specify/templates/commands/*.md (directory does not exist; commands live in
  .claude/skills/speckit-*/SKILL.md and are integration-generic — no edits needed)

Deferred TODOs: none.
-->

# AI Incident Response Orchestrator Dashboard Constitution

> These are the project's **non-negotiable laws** for `Incident-tracker-ui`. Specs, plans,
> contracts and tasks MUST align with this document. The authoritative product spec is
> `docs/ui_prd_incident_orchestrator_dashboard.md` (the "PRD"); this constitution governs *how*
> that PRD is built, never *what* it asks for. Where a feature request and this document
> conflict, this document prevails.

## Core Principles

### I. Contract-First Development

Every public surface MUST be defined by a verifiable contract before implementation.

Required contracts:

- **Component contract** — every reusable component declares: props (typed), possible states,
  emitted events, error cases, loading state, empty state.
- **API contract** — every request the UI makes is declared against the PRD §9 endpoint list:
  method, path, query params, response shape, error responses, side effects.
- **Derivation contract** — every displayed metric declares its inputs, formula, and the rows it
  drills into (see Principle IV).

The UI MUST NOT invent endpoints, response fields, table names, or column names. The data model
is owned upstream by `ai_incident_response_database_schema.md`; entity and field names are given,
not authored here. An undocumented field is a blocked task, not an assumption.

*Rationale: this UI is built against a backend and schema it does not own. Contracts are the only
place a mismatch can be caught cheaply.*

### II. Traceability

Every implementation MUST be traceable through the chain:

`PRD requirement → Specification → Contract → Task → Test → Code`

- Every task cites at least one PRD requirement ID (`AR-*`, `IT-*`, `EO-*`, `TL-*`, `X-*`,
  `A11Y-*`, `P-*`) or a §11 acceptance criterion.
- A task without a related specification is invalid.
- A test without a related requirement is incomplete.
- A PRD requirement with zero covering tasks at plan time is a planning defect.

*Rationale: the PRD is already numbered. Discarding those IDs during planning is how "the build is
done" becomes unprovable.*

### III. Domain Logic Lives Outside the UI

Derivation and business logic MUST live in pure modules that import no React, no HTTP client, and
no ambient clock.

This includes: automation-rate computation, median/percentile math, funnel stage membership, age
threshold evaluation, automation classification (`fully automated` / `human-approved` /
`needs human` / `none`), risk and confidence thresholds, and filter-to-query translation.

- Components render state and dispatch intent. They MUST NOT contain business rules.
- Domain modules MUST be testable with plain function calls — no DOM, no network, no timers.
- Time MUST be injected (a `now` parameter or clock dependency), never read from `Date.now()`
  inside domain code.

*Rationale: every rule that matters here (§6.1, age thresholds, median-not-average) is arithmetic
on a payload. Buried inside a component it is untestable and silently duplicated.*

### IV. Metric Truthfulness

Every number on screen MUST be reproducible, reconcilable, and drillable.

- **Median, never average**, for resolution time in the KPI tile; the average MAY appear in the
  tooltip and MUST be labeled as such (PRD §A1).
- **`ROLLED_BACK` is its own bucket** wherever executions are counted — never folded into success
  and never into failure (EO-1).
- **Funnel stage counts MUST reconcile exactly** with the incident table when a stage is clicked
  (§11.4). A funnel that does not reconcile is broken, not approximate.
- **Automation rate MUST use the PRD §6.1 definition**, and fully-automated and human-assisted
  percentages MUST be displayed as two separate numbers.
- Every KPI tile MUST drill into the filtered row set that produced it.
- No hidden aggregation: a displayed value's definition MUST be discoverable in the UI (tooltip,
  caption, or label).

*Rationale: this dashboard's only job is to be believed. One metric that cannot be reconciled
against its rows discredits the other five.*

### V. Irreversible Actions Are Guarded

Approve and reject fire real remediation against production systems. They are the highest-risk
code in this repo and are governed accordingly.

- **Approve MUST be idempotent** — the control disables synchronously on activation, at most one
  request is in flight per action, and a resolved action can never be re-submitted (X-4).
- **`HIGH` risk MUST require an explicit second confirmation** restating the action; `LOW` and
  `MEDIUM` approve in one click (AR-5).
- **Rejection MUST require a reason**, and writes both `recommended_actions.status='REJECTED'` and
  a `developer_feedback` row (AR-6).
- A mutation MUST NEVER be triggered by a component mount, an effect re-run, a polling tick, a
  retry, a re-render, or a cache revalidation. Mutations originate from explicit user intent only.
- Optimistic updates MUST be reversible: a failed write rolls the UI back and surfaces the error
  (X-1).

*Rationale: a double-fired remediation Lambda is a real outage. This principle is the reason the
approval queue gets more review than the charts.*

### VI. Human-in-the-Loop Transparency

The AI's reasoning MUST be visible, never hidden. A proposed action is not presentable unless its
evidence is reachable in one interaction.

Mandatory disclosures:

- Confidence as a bar **with** its numeric value; below the configured threshold (default 0.70)
  the card is visibly qualified (AR-2).
- "Why this action" expanding to the `similarity_matches` that drove it — doc type, title, score,
  link to `source_url` (AR-4).
- Agent run trace with `FAILED` runs expanded by default and their error visible (§D3).
- AI-vs-human corrections shown side by side when `developer_feedback` carries a corrected
  category or priority (§D2).

*Rationale: an approval gate without evidence is a rubber stamp; the operator is accountable for
the action and MUST be able to judge it.*

### VII. Four States, Always

Every data-bound component MUST declare and implement four distinct states:

| State | Requirement |
|---|---|
| **Loading** | Skeleton matching the final layout. No spinner-on-blank, no layout shift on load. |
| **Empty (no data)** | Explains what will appear and how it arrives. Never a bare "No data". |
| **Empty (filtered)** | Visibly distinct from no-data, with one-click filter clear. |
| **Error** | Inline, component-scoped, retryable, showing what failed. |

Additionally, **stale MUST be labeled**: when polling fails, the affected surface says so
("Last updated 4m ago — reconnecting"). Rendering stale numbers as if live is a defect.

*Rationale: a hackathon dataset produces empty states constantly, and "no incidents match your
filters" versus "no incidents exist" are opposite conclusions for the viewer.*

### VIII. Failure Isolation

One failing request MUST degrade exactly one component.

- Error boundaries MUST be scoped per panel. No boundary may blank the dashboard.
- Panels MUST NOT be coupled to a shared all-or-nothing fetch whose failure removes unrelated
  panels.
- A failed chart MUST leave the queue, table and KPI strip interactive.

*Rationale: the operational band is what someone reaches for during an incident. A broken trend
chart taking down the approval queue is the one failure mode this UI cannot have.*

### IX. The URL Is the Shareable State

Any view a user can see MUST be reproducible by pasting the URL.

The query string MUST carry: time range, environment selection, service selection, active
drill-down filter (KPI tile, funnel stage, or breakdown segment), free-text search, and the open
drawer incident (`?incident=<id>`).

- Filter state MUST NOT exist only in component memory.
- The drawer opens in place over a live dashboard — **never** a page navigation (IT-1).
- Band A shows current state regardless of the selected time range; only Band B is range-filtered
  (§4).

*Rationale: the first thing an on-call engineer does with a useful view is paste it into a channel.*

### X. Accessibility Is a Requirement, Not Polish

- **Colour is never the sole carrier of meaning** — every priority, risk, status and outcome pill
  carries a text label (AR-1, A11Y-1).
- WCAG AA contrast on all pills, chart series, and text (A11Y-2).
- Full keyboard path: tab through approval cards, `Enter` opens detail, `Esc` closes the drawer;
  the drawer traps focus while open and restores it on close (A11Y-3).
- Every chart has an accessible tabular equivalent (A11Y-4).

Accessibility failures are defects on the requirement they violate, not backlog items.

*Rationale: red/green is the primary encoding in this design and is invisible to a meaningful
share of engineers; and this screen gets driven under time pressure, where keyboard wins.*

### XI. Performance Budgets Are Contractual

- First meaningful paint under **2s** on the seeded dataset (P-1).
- KPI tiles render before charts — components load progressively and independently (P-2).
- Every aggregate is served by a single request. No N+1 per-row calls in the table (P-3).
- Large JSONB (`parameters`, `input`, `output`, `execution_logs`, `response_payload`) is fetched
  lazily on expand and **never** included in list responses (P-4).
- Polling: Band A every 30s, Band B on filter change and every 5 minutes, with no layout jump when
  values change (X-2, X-3).

*Rationale: these are stated PRD numbers, so they are testable; a budget nobody measures is a wish.*

### XII. Testability

Every business rule and every PRD requirement ID MUST have an automated test. Tests verify
**behavior**, not implementation details.

Mandatory test areas:

- Automation rate and the fully-automated / human-assisted split (§6.1)
- Median resolution time (and that the tile is not showing an average)
- Funnel stage membership and reconciliation with the table
- `ROLLED_BACK` counted separately from `SUCCESS` and `FAILED`
- Approve idempotency — a double activation issues exactly one request
- `HIGH`-risk confirm flow, and reject-requires-reason
- Age threshold transitions per priority (P1 30m / P2 2h / P3 8h / P4 24h)
- URL round-trip: filters and open drawer survive a reload
- The four states of every data-bound component
- Keyboard traversal of the approval queue and drawer

Determinism rules:

- The clock is injected. Relative timestamps and age thresholds are tested without waiting.
- Tests run against a mocked HTTP boundary — never a live backend.
- A fixed timezone is pinned in test setup.

*Rationale: §11 is a list of ten acceptance criteria; each one is a test or it is an opinion.*

### XIII. Least Trust in the Client

- Secrets MUST NEVER appear in source, config committed to the repo, or the shipped bundle.
- The UI is **not** the authorization gate. Hiding a control is a UX decision; the server enforces
  permission. Approve/reject MUST be safe to reject server-side.
- Text originating outside this app — `error_message`, `execution_logs`, `response_payload`,
  document titles, incident descriptions — MUST be rendered as text, never as HTML.
- External links (`source_url`) MUST open with `rel="noopener noreferrer"`.
- The UI requests only the fields the screen needs and MUST NOT log payloads containing incident
  content to third parties.

*Rationale: this dashboard renders attacker-influenceable strings (email-sourced incident titles,
remediation logs) directly into an operator's browser.*

### XIV. Scope Discipline

The PRD's v1 non-goals stay out of scope: incident creation/editing from the UI, knowledge base or
runbook authoring, user management/RBAC/on-call rotation/SLA configuration, and historical report
export (PRD §1).

- Actions with `approval_required = FALSE` MUST NOT appear in the approvals queue (AR-10).
- The PRD §10 schema gaps MUST NOT be worked around by inventing columns or inferring values from
  JSONB. Either the gap is closed upstream, or the UI degrades explicitly and says what is
  unavailable.
- Build order follows PRD §12; phases 1–2 are the minimum coherent product.

*Rationale: a hackathon MVP fails by breadth. Every non-goal implemented is an acceptance criterion
not met.*

## Technology and Architecture Constraints

**Stack (fixed):**

- **React** single-page application with **TypeScript in strict mode**.
- **Functional components only.** No class components.
- **Typed props on every component.** `any` is forbidden in props, contracts, and API types.
- **React Hook Form** for every form (reject reason, feedback, assignment).
- **React Testing Library** for component and interaction tests.

**Layering (mandatory):**

```
components/   presentation + interaction only (Principle III)
domain/       pure derivations, thresholds, metric math — no React, no fetch, no clock
api/          typed client per PRD §9 endpoint, one module per resource
```

- Components MUST classify as exactly one of: Page, Layout, Feature Component, Shared Component,
  Form Component, UI Primitive.
- The `api/` layer is the only place `fetch` appears, and every endpoint has a declared response
  type. A **mock implementation of the same typed interface** MUST be swappable for the real
  client, so the UI is buildable and demoable before the backend exists.
- Server state MUST flow through a caching/invalidation layer, not ad-hoc `useEffect` fetches, so
  that polling (X-2) and per-component error isolation (Principle VIII) are structural rather than
  hand-rolled per panel.

**Choices deliberately left open** — library selections for build tooling, routing, server-state
caching, charting, and end-to-end testing are made in the feature's `plan.md`, and recorded in an
ADR under `docs/adr/` when the decision outlives one feature. Any charting library chosen MUST be
able to satisfy A11Y-4 (tabular equivalent) and WCAG AA contrast.

`docs/incident_dashboard_prototype.html` is a **visual reference only** — a dependency-free
wireframe. It MUST NOT be extended, bundled, or imported as application code.

## Development Workflow and Quality Gates

**Flow.** Work proceeds through Spec Kit: `/speckit.constitution` → `/speckit.specify` →
`/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.analyze` →
`/speckit.implement`. Artifacts land in `specs/<NNN>-slug/`.

**Gate 1 — Plan.** `plan.md` MUST pass the Constitution Check before Phase 0 research and again
after Phase 1 design. Any violation is recorded in Complexity Tracking with the simpler
alternative and why it was rejected. An unjustified violation blocks the plan.

**Gate 2 — Tasks.** Every task carries its PRD requirement ID (Principle II). Every PRD
requirement in scope has at least one covering task and at least one test task.

**Definition of done** for any requirement:

1. Contract declared (Principle I).
2. Domain logic in `domain/` with unit tests (Principles III, XII).
3. Component implements all four states (Principle VII).
4. Accessibility obligations met for the affected surface (Principle X).
5. Automated test asserting the requirement's observable behavior, passing.
6. No new `any`, no new secret, no new `dangerouslySetInnerHTML` (Principle XIII).

**Review.** A change touching approve/reject (Principle V) requires explicit reviewer sign-off on
idempotency and the confirm path. Metric changes (Principle IV) require the reconciliation test to
be shown passing.

## Governance

This constitution supersedes all other practices, conventions, and preferences in this repository.
When a requested feature conflicts with it, the constitution prevails — the spec, plan, or task is
adjusted, not the principle.

**Amendment procedure.** A constitutional change MUST be proposed through `/speckit.constitution`
and MUST document:

- Reason for the change
- Impacted specifications
- Migration strategy for code already written under the old rule
- Updated contracts
- Updated tests

Silent constitutional changes are forbidden. An amendment lands with its Sync Impact Report and
propagated template edits in the same commit.

**Versioning policy.** Semantic versioning of this document:

- **MAJOR** — a principle is removed or redefined in a backward-incompatible way, or governance
  changes such that previously compliant work is now non-compliant.
- **MINOR** — a new principle or section is added, or existing guidance is materially expanded.
- **PATCH** — clarification, wording, typo, or non-semantic refinement.

**Compliance review.** Compliance is verified at three points: the `plan.md` Constitution Check,
`/speckit.analyze` (constitution violations are always CRITICAL), and code review against the
Definition of Done above. Runtime development guidance lives in `CLAUDE.md`; it MUST NOT contradict
this document, and is updated in the same commit when this document changes.

**Version**: 1.0.0 | **Ratified**: 2026-08-13 | **Last Amended**: 2026-08-13
