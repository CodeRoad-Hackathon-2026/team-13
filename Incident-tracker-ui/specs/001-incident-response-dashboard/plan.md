# Implementation Plan: AI Incident Response Orchestrator Dashboard

**Branch**: `001-incident-response-dashboard` | **Date**: 2026-08-14 | **Revised**: 2026-08-16 (PRD v2.0)
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-incident-response-dashboard/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Revision note (v1.0 → v2.0)

This plan is revised in place following spec.md's full re-spec against PRD v2.0 (persistent alert
strip + three tabs, replacing two stacked bands). The Technical Context and Constitution Check below
hold at the principle and library-decision level — nothing in research.md's Vite/TanStack
Query/Recharts/MSW/sql-formatter/`useFocusTrap` decisions is invalidated by the IA change. What
changed: two new research decisions (tabs, §11–12 of research.md) and the Project Structure's
component tree (`AlertStrip`/`TabBar` replace `BandA`/`BandB`; Knowledge-tab and feedback-impact
components are new). Phase 1 (Setup) is complete and untouched by this revision — see tasks.md.

## Summary

A single-page React dashboard: a **persistent alert strip** (P1-active + awaiting-approval counts,
visible and polling on every tab) above **three tabs** — Now (operational KPIs, the approval queue,
the incident table), Performance (automation KPIs, the funnel, execution outcomes, volume and
breakdowns), and Knowledge (coverage gaps, documents driving resolutions, documentation candidates)
— plus a deep-linkable detail drawer per incident whose feedback section includes a
classifier-accuracy widget. The technical approach: React + TypeScript against a typed `api/` layer
whose HTTP boundary is served by MSW from one seeded-fixture module — so the whole feature is
buildable and demoable with no backend running (spec.md Assumption 1) — with TanStack Query giving
each panel its own fetch/poll/error lifecycle (Principle VIII), a hand-written URL-state hook making
every filter, the active tab, and the open drawer shareable (Principle IX), hand-rolled ARIA-pattern
tabs that keep all three tab panels mounted so cross-tab polling and "no refetch on switch" fall out
of the architecture rather than needing special-casing (research.md §11), and all metric math
(median, automation rate, funnel drop-sets, age thresholds, feedback-accuracy agreement rate)
isolated in clock-injected `domain/` modules with zero React or fetch dependencies (Principle III).

## Technical Context

**Language/Version**: TypeScript, strict mode — fixed by constitution (Technology Constraints)
**Primary Dependencies**: React + React Hook Form (fixed) · TanStack Query (server state,
Principle VIII/XI) · Recharts (charts, A11Y-4-capable) · `sql-formatter` + a hand-written regex
tokenizer (safe syntax highlighting, Principle XIII) · MSW (mocked HTTP boundary, dev + test,
Principle XII) · Vite (build/dev). No tabs/routing library — hand-rolled per research.md §11.
**Storage**: `localStorage` for the self-declared operator name only (FR-121); no other
client-owned persistence — view state (including the active tab) lives in the URL (Principle IX),
server state in TanStack Query's cache
**Testing**: React Testing Library (fixed) + Vitest (unit/component) + Playwright (e2e, keyboard
traversal, focus-trap — jsdom cannot model these) + MSW (same fixtures back both test-time mocking
and dev-without-backend, research.md §7)
**Target Platform**: Evergreen desktop browsers (latest two versions of Chrome, Edge, Firefox,
Safari). No mobile layout — the PRD's fixed tab/strip layout and the prototype's ~1360px max-width
design assume a desk-bound operator, and no responsive breakpoint appears anywhere in the PRD.
**Project Type**: Single-page React frontend; backend consumed via the PRD's API surface (currently
absent — see Assumption 1 and research.md §7)
**Performance Goals**: FMP < 2s on the seeded dataset (P-1); Now-tab tiles paint before any chart
(P-2); one request per aggregate, no N+1 (P-3)
**Constraints**: JSONB (`parameters`, `input`, `output`, `execution_logs`, `response_payload`)
lazy-loaded only, never in list/queue responses (P-4); the alert strip polls 30s regardless of
active tab (X-2, FR-015); Performance/Knowledge refresh on filter change + 5min; no layout jump
(X-3); execution polling bounded at 2 minutes before switching to a slower "still running" cadence
(FR-041); tab switches trigger no refetch and no skeleton (FR-019)
**Scale/Scope**: Seeded hackathon dataset (~142 incidents/period, dozens of pending actions, 5–6
services, ~1,284 knowledge chunks) across the alert strip plus three tabs' worth of panels, all
mounted simultaneously (research.md §11)

*All research decisions and rationale: [research.md](./research.md).*

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Mark each gate PASS / VIOLATION (justify in Complexity Tracking) / N/A for this feature.

**Re-verified against the v2.0 spec (2026-08-16)** — all 14 gates re-checked against the new
FR-001–FR-121 numbering; none regressed by the IA change:

- [x] **I. Contract-First** — PASS. `data-model.md`, `contracts/*.md`, and the component inventory
      are being regenerated against the new API surface (alert-strip/now/performance/knowledge)
      before any code changes; full per-component contracts still deferred to task-level per the
      Definition of Done.
- [x] **II. Traceability** — PASS. Every FR in the revised spec.md cites a PRD ID; mechanically
      verified 100% coverage of all 62 v2.0 PRD IDs and all 10 new §11 acceptance criteria
      (checklists/requirements.md, iteration 4).
- [x] **III. Domain outside UI** — PASS. `domain/` gains `filters.ts`'s cross-tab jump rules and a
      new `feedbackAccuracy.ts` (agreement-rate computation, FR-075); no metric math planned inside
      a component. Tabs themselves are pure UI state (`TabBar`), not domain logic.
- [x] **IV. Metric truthfulness** — PASS. FR-081 (median), FR-089 (automation split), FR-091
      (rolled-back bucket), FR-086 (funnel reconciliation), and the new FR-075 (feedback-accuracy
      formula, resolved via clarify rather than left to guesswork) are all in scope with a named
      owning contract.
- [x] **V. Guarded irreversible actions** — PASS. FR-037/FR-044/FR-045 map to the approve/reject
      contracts; FR-042 (sibling-card survival, §11.19) is a new explicit requirement closing the
      one gap PRD v2 itself calls out as a real v1 bug.
- [x] **VI. HITL transparency** — PASS. FR-034, FR-036, FR-065, FR-063 all have an owning component;
      the feedback-impact widget (FR-074–FR-079) adds a second transparency surface (why the
      classifier is trusted, not just why one action is).
- [x] **VII. Four states** — PASS. `PanelBoundary` remains the shared mechanism; the alert strip's
      calm-vs-broken distinction (FR-010, Edge Cases) is a variant of the same pattern applied to a
      component that must never show a false "everything's fine" via disappearing.
- [x] **VIII. Failure isolation** — PASS. One query per panel remains the rule; the alert strip is
      its own query specifically so a heavier Performance/Knowledge aggregate can never block it
      (research.md §12, mirroring the PRD's own "must never be blocked behind a heavier aggregate
      query" language).
- [x] **IX. URL is shareable state** — PASS. FR-005/FR-017 add the active tab to the URL-state set;
      FR-025/FR-026 keep the single-active-filter rule, now scoped across tabs rather than one page.
- [x] **X. Accessibility** — PASS. FR-016 (tablist/tab/tabpanel roles, arrow-key nav) is a new,
      concrete accessibility requirement on top of the text-labeled pills, `useFocusTrap`, and
      `AccessibleChartTable` carried over from v1.0.
- [x] **XI. Performance budgets** — PASS. FR-019 (no refetch/skeleton on tab switch) is a stronger
      performance requirement than v1.0 had, and is satisfied structurally by research.md §11's
      always-mounted-panels decision rather than needing extra work.
- [x] **XII. Testability** — PASS. Mandatory test areas gain: tab keyboard navigation, cross-tab
      jump legibility (flash/toast/chip), sibling-card DOM survival, alert-strip liveness while
      another tab is active, and feedback-accuracy formula correctness at the suppression boundary
      (9 vs. 10 corrections).
- [x] **XIII. Least trust in client** — PASS. No change from v1.0's clean bill — `rel="noopener
      noreferrer"`, no `dangerouslySetInnerHTML`, server remains the authorization gate.
- [x] **XIV. Scope discipline** — PASS. PRD §13's explicitly rejected patterns (tab-behind-approval-
      queue, drawer-as-page, role-based views, all five gamification patterns) are now a named
      "Also explicitly rejected" subsection in spec.md's Out of Scope, not left implicit.

All 14 gates PASS. No entries required in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-incident-response-dashboard/
├── plan.md                  # This file
├── research.md              # Phase 0 — v1.0 decisions + §11-12 added for v2.0 (tabs, strip polling)
├── data-model.md            # Phase 1 — entities, fields, PRD citations, [INFERRED]/[GAP] flags
├── component-inventory.md   # Phase 1 — component list + classification (Principle I granularity for planning)
├── quickstart.md            # Phase 1 — run/verify instructions
├── contracts/
│   ├── dashboard-endpoints.md   # alert-strip / now / performance / knowledge
│   ├── incidents-endpoints.md
│   ├── approvals-endpoints.md
│   └── feedback-endpoint.md     # feedback writes + feedback-impact read
├── checklists/
│   └── requirements.md      # from /speckit-specify + /speckit-clarify, 4 validation iterations
└── tasks.md                 # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

**Structure Decision**: Unchanged from v1.0 — single project, no `backend/`+`frontend/` split.
Layering is fixed by the constitution's Technology Constraints (`components/` · `domain/` · `api/`);
`state/` holds the URL hook, operator context, and (new) the tab-aware focus/roving-tabindex helper.
Tests remain colocated as `*.test.tsx`/`*.test.ts` next to the source they cover, with Playwright
specs under `tests/e2e/`.

```text
src/
├── main.tsx
├── App.tsx
├── components/
│   ├── layout/          # DashboardHeader, AlertStrip, TabBar, TabPanel
│   ├── kpi/             # KpiStrip (now per-tab-scoped), KpiTile
│   ├── approvals/       # ApprovalQueue, ApprovalCard, ApproveConfirmModal, RejectForm,
│   │                    # ParametersViewer, WhyThisAction, OperatorNamePrompt
│   ├── incidents/       # IncidentTable, IncidentRow, IncidentDetailDrawer,
│   │                    # IncidentHeaderActions, ClassificationPanel, AgentRunTrace,
│   │                    # SimilarityMatchList, ActionsAndExecutions, EventTimeline,
│   │                    # FeedbackImpactWidget, FeedbackForm
│   ├── charts/          # AutomationFunnel, ExecutionOutcomeDonut, VolumeChart, BreakdownBars,
│   │                    # CoverageGapsChart, DocumentsDrivingResolutions,
│   │                    # DocumentationCandidates, AccessibleChartTable
│   └── shared/          # PanelBoundary, StaleBanner, RelativeTime, ConfidenceBar, pills,
│                        # CrossTabFilterChip, CrossTabToast
├── domain/              # automationIcon.ts, funnel.ts, age.ts, kpi.ts, filters.ts,
│                        # feedbackAccuracy.ts, timeline.ts, volumeBuckets.ts, rejection.ts, clock.ts
├── api/
│   ├── client.ts         # typed fetch wrapper
│   ├── types.ts          # mirrors data-model.md
│   ├── dashboard/        # alertStrip.ts, now.ts, performance.ts, breakdowns.ts, knowledge.ts
│   ├── incidents/        # list.ts, detail.ts
│   ├── approvals/        # pending.ts, approve.ts, reject.ts, execution.ts
│   ├── feedback.ts, feedbackImpact.ts
│   └── fixtures/         # MSW seed data + handlers (research.md §7)
└── state/                # useUrlState.ts, OperatorContext.tsx, queryClient.ts, useFocusTrap.ts

tests/
└── e2e/                  # Playwright specs (approve/reject flow, tab keyboard nav, cross-tab jump,
                          # sibling-card survival, focus trap)
```

Full per-component contracts (component-inventory.md's deferred detail) are written at task-level,
immediately preceding each component's implementation task, per the constitution's Definition of
Done item 1 — `/speckit-tasks` is expected to make "write the contract" the first checklist item of
each component task rather than a separate task.

## Complexity Tracking

*No entries — Constitution Check has zero violations.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
