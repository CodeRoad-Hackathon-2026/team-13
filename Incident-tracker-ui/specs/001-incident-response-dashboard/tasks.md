# Tasks: AI Incident Response Orchestrator Dashboard

**Revised for PRD v2.0** (persistent alert strip + Now/Performance/Knowledge tabs, replacing two
stacked bands). FR numbers match spec.md's post-re-spec numbering (FR-001–FR-121). Phase 1 (Setup)
was completed against v1.0 and is untouched by this revision — no scaffolding it produced is
affected by the IA change. Every phase from Foundational onward is regenerated.

**Input**: Design documents from `/specs/001-incident-response-dashboard/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [component-inventory.md](./component-inventory.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: MANDATORY (Constitution Principle XII). Every user story phase writes its tests first;
implementation follows. `[REQ]` on every task cites the PRD requirement ID(s) spec.md attached to
the functional requirement(s) it satisfies — the FR number itself appears in the description text
for a direct spec.md lookup.

## Format: `[ID] [P?] [Story] [REQ] Description`

- **[P]**: different file, no dependency on an incomplete task in this list
- **[Story]**: `US1`/`US2`/`US3`/`US4`/`US5` — omitted for Setup, Foundational, and Polish
- **[REQ]**: PRD requirement ID(s) or §11 criterion, per Constitution Principle II

## Path Conventions

React SPA, single project (plan.md → Project Structure): `src/components/`, `src/domain/`,
`src/api/`, `src/state/` at repository root; component/unit tests colocated as `*.test.ts(x)`;
Playwright specs under `tests/e2e/`.

---

## Phase 1: Setup — COMPLETE (unaffected by PRD v2.0)

**Purpose**: Scaffold the project. Completed against v1.0; nothing here is IA-specific.

- [X] T001 Initialize Vite + React + TypeScript-strict project (`package.json`, `vite.config.ts`,
      `tsconfig.json` with `strict: true`, `noImplicitAny: true`) at repo root (research.md §1)
- [X] T002 [P] Configure ESLint + Prettier for TS/React, forbidding `any` (constitution Technology
      Constraints) in `eslint.config.js`
- [X] T003 [P] Configure Vitest sharing Vite's config + RTL setup file in `vitest.config.ts` /
      `tests/setupTests.ts` (research.md §5)
- [X] T004 [P] Configure Playwright (`playwright.config.ts`, `tests/e2e/`) (research.md §6)
- [X] T005 [P] Install and scaffold MSW: `src/api/fixtures/browser.ts` (`setupWorker`) and
      `src/api/fixtures/server.ts` (`setupServer`) (research.md §7)
- [X] T006 Create directory skeleton: `src/components/{layout,kpi,approvals,incidents,charts,
      shared}/`, `src/domain/`, `src/api/{dashboard,incidents,approvals}/`, `src/api/fixtures/
      handlers/`, `src/state/`, `tests/e2e/` (plan.md → Project Structure)
- [X] T007 [P] Add `dev`/`build`/`test`/`test:e2e`/`typecheck`/`lint` scripts to `package.json`
      (quickstart.md)

**Checkpoint**: Done. `npm run dev`/`test`/`test:e2e`/`typecheck`/`lint`/`build` all verified green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure every user story's panels depend on — now including the alert strip and
the tab shell, which PRD v2 itself calls load-bearing for every decision after it ("Build the strip
in phase 1, not phase 5"). US2's queue is reachable via the strip's button (FR-011), and every
story's content lives inside a `TabPanel`, so both are genuine cross-story dependencies, not just
US1's concern.

**⚠️ CRITICAL**: Blocks all user stories.

- [X] T008 Define shared types in `src/api/types.ts` mirroring data-model.md's ten entities
      (including the new `KnowledgeEmbedding`) and the expanded `Incident.status` enum
      (`OPEN`/`ESCALATED`/`INVESTIGATING`/`MITIGATED`/`RESOLVED`/`CLOSED`); mark `[INFERRED]`/`[GAP]`
      fields with a code comment pointing back to data-model.md
- [X] T009 [P] Build the seeded fixture dataset in `src/api/fixtures/seededDataset.ts` from the
      PRD's own numbers (funnel: 142/98/87/79/71/68; breakdown counts; ~1,284 knowledge chunks
      across 4+ document types; ≥10 team-wide `developer_feedback` rows so the feedback-impact
      widget renders by default per the mock's own "12 corrections · team 61" figures — see FR-077)
      (research.md §7)
- [X] T010 Create the MSW handler barrel `src/api/fixtures/handlers/index.ts` (starts empty; each
      story phase appends its own handler module here)
- [X] T011 Wire MSW worker registration into `src/main.tsx`, dev-mode only (research.md §7)
- [X] T012 [P] Implement `src/api/client.ts`: typed `fetch` wrapper (base URL, JSON parsing, error
      normalization) — the only place `fetch` appears (constitution Technology Constraints)
- [X] T013 [P] [REQ Principle III] Implement `src/domain/clock.ts`: a `Clock` interface + a
      system-clock implementation, injected everywhere else in `domain/` — never `Date.now()`
      called directly outside this file
- [X] T014 [P] [REQ Principle III,XII] Unit test for `domain/clock.ts` (default vs. injected
      clock) in `src/domain/clock.test.ts`
- [X] T015 [P] [REQ PRD §3B,§B1,§B4 / FR-025,FR-026] Implement `src/domain/filters.ts`: pure
      functions for "at most one active filter across all tabs, selecting a new one replaces the
      old" and "clear a filter without disturbing global filters or navigating tabs" (FR-024)
- [X] T016 [P] [REQ FR-025,FR-026,FR-024] Unit test for `domain/filters.ts` (replace-not-accumulate;
      clear leaves time range/env/service/search untouched and does not change the active tab) in
      `src/domain/filters.test.ts`
- [X] T017 [REQ PRD §4,§7,TB-2 / FR-001,FR-002,FR-003,FR-004,FR-005,FR-017,FR-059] Implement `src/state/useUrlState.ts`:
      typed hook over `URLSearchParams` + `history.replaceState` exposing tab/time
      range/env/service/search/includeResolved/drill-down/`incident` (internal id), built on
      `domain/filters.ts`; an unrecognized `tab` value falls back to `now` (FR-017) (research.md §2)
- [X] T018 [REQ TB-5,§11.17 / FR-005,FR-017,FR-020,FR-059,SC-010] Test for `useUrlState`
      round-trip (set → serialize → parse restores identical state, including tab; bad tab value
      falls back to `now`) **and** that changing the tab param in isolation leaves time
      range/env/service/search/includeResolved/drill-down untouched, in both switch directions
      (FR-020) — in `src/state/useUrlState.test.ts`
- [X] T019 [P] Implement `src/state/queryClient.ts`: TanStack `QueryClient` with shared defaults
      (retry, `staleTime`) (research.md §3)
- [X] T020 [P] [REQ AR-8,FR-119,FR-121 / Assumption 10,12] Implement `src/state/
      OperatorContext.tsx`: React Context + `localStorage`-backed operator name, plus the
      configurable low-confidence threshold (default 0.70) — scaffold only; the
      prompt-blocks-until-supplied behavior (FR-120) is wired in US2, where attribution first
      matters
- [X] T021 [REQ FR-119,FR-121] Unit test for `OperatorContext` (localStorage persistence,
      change-name) in `src/state/OperatorContext.test.tsx`
- [X] T022 [P] [REQ Principle VII / FR-105,FR-106] Implement `src/components/shared/
      PanelBoundary.tsx`: error boundary + the four-state switch (loading skeleton /
      empty-no-data / empty-filtered / inline retryable error)
- [X] T023 [REQ FR-105,FR-106,Principle VIII] Component test for `PanelBoundary`'s four states and
      that its failure doesn't propagate outward, in `src/components/shared/PanelBoundary.test.tsx`
- [X] T024 [P] [REQ Principle VII stale rule / FR-107] Implement `src/components/shared/
      StaleBanner.tsx`: "Last updated Nm ago — reconnecting"
- [X] T025 [P] [REQ X-5 / FR-110 / Assumption 9] Implement `src/components/shared/
      RelativeTime.tsx`: relative by default, absolute + timezone on hover
- [X] T026 [REQ X-5,FR-110] Unit test for `RelativeTime` formatting with an injected clock in
      `src/components/shared/RelativeTime.test.tsx`
- [X] T027 [P] [REQ AR-2 / FR-034,FR-111] Implement `src/components/shared/ConfidenceBar.tsx`:
      bar + numeric value + low-confidence qualifier, reading the threshold from `OperatorContext`
- [X] T028 [P] [REQ AR-1,A11Y-1 / FR-033,FR-111] Implement `src/components/shared/
      PriorityPill.tsx`, `StatusPill.tsx` (covering the full v2.0 status enum, including
      `INVESTIGATING`/`MITIGATED`), `RiskBadge.tsx`, `OutcomeBadge.tsx` — every one renders a text
      label alongside colour, never colour alone
- [X] T029 [REQ A11Y-1,A11Y-2] Component tests for all four pill/badge components (text label
      present, including the two new status values; contrast-safe class applied) in
      `src/components/shared/*Pill*.test.tsx` and `*Badge*.test.tsx`
- [X] T030 [P] [REQ A11Y-3] Implement `src/state/useFocusTrap.ts`: cycles Tab/Shift+Tab within a
      container ref, restores focus to the triggering element on close (research.md §9)
- [X] T031 [REQ A11Y-3] Unit test for `useFocusTrap` (cycling, restore-on-close) in
      `src/state/useFocusTrap.test.ts`
- [X] T032 [P] [REQ A11Y-4] Implement `src/components/shared/AccessibleChartTable.tsx`: renders a
      domain-computed series as a table, visibly toggled
- [X] T033 [REQ A11Y-4] Component test for `AccessibleChartTable` toggle + table content in
      `src/components/shared/AccessibleChartTable.test.tsx`
- [X] T034 [P] [REQ AS-1,AS-2,AS-3,AS-4,AS-5,AS-6,AS-7,AS-8,X-2 / FR-007,FR-008,FR-009,FR-010,FR-011,FR-012,FR-013,FR-014,FR-015] Implement `src/api/dashboard/alertStrip.ts` +
      `src/components/layout/AlertStrip.tsx`: own TanStack Query (`GET /api/dashboard/alert-strip`,
      30s `refetchInterval` unconditional on tab visibility per research.md §12), `hot`/`warm`/
      `calm` states, the calm resting message (FR-010), `role="status"`/`aria-live="polite"`
      (FR-013), both counts clickable (FR-011) via `useUrlState`
- [X] T035 [REQ AS-1,AS-2,AS-3,AS-4,AS-5,AS-6,AS-7,AS-8,§11.11,§11.13 / FR-007,FR-008,FR-009,FR-010,FR-011,FR-012,FR-013,FR-014,FR-015] Component test for `AlertStrip`: all three
      severity states, the calm message rendered instead of disappearing, both buttons route
      correctly without changing the strip's own counts, `aria-live="polite"` not `assertive`, in
      `src/components/layout/AlertStrip.test.tsx`
- [X] T036 [P] MSW handler for `GET /api/dashboard/alert-strip` in `src/api/fixtures/handlers/
      alertStrip.ts`
- [X] T037 [P] [REQ TB-1,TB-2,TB-3 / FR-016,FR-017,FR-018] Implement `src/components/layout/TabBar.tsx`:
      `role="tablist"`/`role="tab"`/`aria-selected`, roving-tabindex arrow-key navigation, tab
      state via `useUrlState`, Now's badge hidden at zero (FR-018)
- [X] T038 [REQ TB-1,TB-2,TB-3,A11Y-3,§11.14,§11.18 / FR-016,FR-017,FR-018] Component test for `TabBar`:
      arrow-key navigation, ARIA roles, badge hidden at zero (never "0"), URL round-trip, in
      `src/components/layout/TabBar.test.tsx`
- [X] T039 [P] [REQ TB-4 / FR-019] Implement `src/components/layout/TabPanel.tsx`: always mounted,
      visibility toggled via the native `hidden` attribute — never conditional rendering
      (research.md §11)
- [X] T040 [REQ TB-4 / FR-019] Test confirming a hidden `TabPanel`'s content is excluded from the
      accessibility tree and tab order (via the `hidden` attribute) in
      `src/components/layout/TabPanel.test.tsx`
- [X] T041 Implement `src/App.tsx`: mounts `QueryClientProvider`, `OperatorContext.Provider`,
      `AlertStrip` (outside any `TabPanel`), `TabBar`, and the three `TabPanel`s
- [X] T042 [P] [REQ PRD §4 / FR-001,FR-002,FR-003,FR-004,FR-006] Implement `src/components/layout/
      DashboardHeader.tsx`: title, environment multi-select, service dropdown (all-services
      default), time-range segmented control with the FR-004 tooltip ("applies to Performance/
      Knowledge only"), live indicator + manual refresh — all wired to `useUrlState`
- [X] T043 [REQ FR-001,FR-002,FR-003,FR-004,FR-006] Component test for `DashboardHeader` (each
      control, including the service dropdown, updates URL state correctly; tooltip present on the
      time-range control) in `src/components/layout/DashboardHeader.test.tsx`
- [X] T044 Implement `src/main.tsx`: entry point mounting `App` inside providers

**Checkpoint**: Foundation ready. `npm run dev` shows the alert strip and tab bar with three empty
panels; every shared primitive and hook has a passing unit/component test. User story work can
begin.

---

## Phase 3: User Story 1 - Triage without ever losing sight of what's critical (Priority: P1) 🎯 MVP

**Goal**: The Now tab's four operational tiles, the incident table, and the read-only drawer —
proving the data model end to end, with the alert strip (built in Foundational) already telling the
truth from the moment this story is demoable.

**Independent Test**: Load against the seeded dataset; verify the alert strip's hot/warm/calm state,
the four Now tiles, table filtering/sort/search, row-click-opens-drawer-without-navigation, and URL
round-trip (tab + filters + open incident) on reload (spec.md's own Independent Test).

### Tests for User Story 1 (MANDATORY — write first) ⚠️

- [X] T045 [P] [US1] [REQ N1 / FR-027,FR-028,FR-029,FR-030,§11.11] Contract test for `GET /api/dashboard/now` (four
      tile shapes; confirms neither `p1Active` nor `awaitingApproval` appears here) in
      `src/api/dashboard/now.contract.test.ts`
- [X] T046 [P] [US1] [REQ IT-1,IT-2,IT-3,IT-4,IT-5,IT-6,P-3,P-4 / FR-048,FR-049,FR-050,FR-051,FR-052,FR-053,FR-054,FR-055,FR-056,FR-057] Contract test for `GET /api/incidents`
      (filter/sort/search/pagination params, `totalCount`, zero JSONB fields present) in
      `src/api/incidents/list.contract.test.ts`
- [X] T047 [P] [US1] [REQ PRD §D1-D6,§11.6 / FR-058,FR-059,FR-060,FR-061,FR-062,FR-063,FR-064,FR-065,FR-066,FR-067,FR-068,FR-069,FR-070,FR-071,FR-072] Contract test for
      `GET /api/incidents/:id` (top-level shape, no inline JSONB, 404 handling) in
      `src/api/incidents/detail.contract.test.ts`
- [X] T048 [P] [US1] [REQ N1 / FR-028,FR-029] Component test for `KpiTile` (Now variant):
      urgent/cautionary styling, click sets the filter, in `src/components/kpi/KpiTile.test.tsx`
- [X] T049 [P] [US1] [REQ P-2 / FR-027,FR-116,§11.11] Component test for `KpiStrip` (Now variant):
      renders all four tiles from one query, renders before any chart, neither strip metric
      duplicated, in `src/components/kpi/KpiStrip.now.test.tsx`
- [X] T050 [P] [US1] [REQ IT-2,IT-3,IT-4,IT-5 / FR-050,FR-051,FR-052,FR-053,FR-055,FR-056] Component test for
      `IncidentTable`: header sort, free-text search, include-resolved toggle, pagination at 25
      rows, age flagging, escalated/non-prod styling, in `src/components/incidents/
      IncidentTable.test.tsx`
- [X] T051 [P] [US1] [REQ IT-1,IT-6,§11.6 / FR-049,FR-054] Component test for `IncidentRow`: click
      opens the drawer via URL state with no navigation event, source-badge icon renders in the
      title cell, in `src/components/incidents/IncidentRow.test.tsx`
- [X] T052 [P] [US1] [REQ PRD §7,A11Y-3 / FR-058,FR-059] Component test for
      `IncidentDetailDrawer`: opens over an interactive dashboard, `Esc`/click-outside close,
      focus returns to the opening row, in `src/components/incidents/
      IncidentDetailDrawer.test.tsx`
- [X] T053 [P] [US1] [REQ PRD §D3,§11.6 / FR-065] Component test for `AgentRunTrace`: `FAILED`
      run expanded by default with its error visible, all others collapsed, in
      `src/components/incidents/AgentRunTrace.test.tsx`
- [X] T054 [P] [US1] [REQ PRD §D4 / FR-066] Component test for `SimilarityMatchList`: capped at
      five, "show all" fetches the rest, in `src/components/incidents/
      SimilarityMatchList.test.tsx`
- [X] T055 [P] [US1] [REQ TL-1,TL-2,TL-3 / FR-069,FR-070,FR-071,FR-072] Component test for `EventTimeline`:
      agent-only filter, failure-event flags, cumulative elapsed time per row, in
      `src/components/incidents/EventTimeline.test.tsx`
- [X] T056 [P] [US1] [REQ §11.7,§11.18,SC-010 / FR-017,FR-059] Playwright e2e: open
      `?tab=now&incident=<internal-id>` directly, confirm the drawer is open on the Now tab on
      load; reload, confirm it's still open, in `tests/e2e/deepLink.spec.ts`
- [X] T057 [P] [US1] [REQ SC-002,SC-003 / FR-116] Playwright e2e: golden-path triage — load,
      confirm the alert strip renders before any tile, confirm tiles render before any chart, click
      a KPI tile, click the resulting row, read every drawer section — in
      `tests/e2e/triage.spec.ts`

### Domain for User Story 1

- [X] T058 [P] [US1] [REQ PRD §N3 / FR-055] Implement `src/domain/age.ts`: per-priority age
      thresholds (P1 30m / P2 2h / P3 8h / P4 24h) as a pure function of `createdAt` + injected
      clock
- [X] T059 [P] [US1] [REQ FR-055] Unit test for `domain/age.ts` threshold transitions in
      `src/domain/age.test.ts`
- [X] T060 [P] [US1] [REQ N1] Implement `src/domain/kpi.ts`: per-tile delta-is-good-or-bad
      interpretation for the four Now tiles (US3 later extends this file with the
      median-resolve null-guard/no-value formatting needed by Performance's tiles)
- [X] T061 [P] [US1] [REQ N1] Unit test for `domain/kpi.ts`'s Now-tile delta logic in
      `src/domain/kpi.test.ts`
- [X] T062 [P] [US1] [REQ PRD §N3,A11Y-1] Implement `src/domain/automationIcon.ts`: maps the
      server-computed `automationStatus` enum to an icon + text label (🤖/👤/⚠️/—)
- [X] T063 [P] [US1] [REQ A11Y-1] Unit test for `domain/automationIcon.ts` covering all four
      values in `src/domain/automationIcon.test.ts`
- [X] T064 [P] [US1] [REQ TL-3] Implement `src/domain/timeline.ts`: `cumulativeElapsed(eventAt,
      incidentCreatedAt)` — a pure timestamp difference, no clock needed (both are historical)
- [X] T065 [P] [US1] [REQ TL-3] Unit test for `domain/timeline.ts` in
      `src/domain/timeline.test.ts`

### API + MSW for User Story 1

- [X] T066 [P] [US1] [REQ FR-027,FR-028,FR-029,FR-030] Implement `src/api/dashboard/now.ts`
- [X] T067 [P] [US1] MSW handler for `GET /api/dashboard/now` in `src/api/fixtures/handlers/
      dashboardNow.ts`, sourced from `seededDataset.ts`
- [X] T068 [P] [US1] [REQ IT-1,IT-2,IT-3,IT-4,IT-5,IT-6,P-3,P-4 / FR-048,FR-049,FR-050,FR-051,FR-052,FR-053,FR-054,FR-055,FR-056,FR-057,FR-117] Implement `src/api/incidents/
      list.ts` (all query params from contracts/incidents-endpoints.md, one request with no
      per-row follow-up per FR-117; the `candidate=true` param is accepted here but its meaningful
      filtering is added by US4)
- [X] T069 [P] [US1] MSW handler for `GET /api/incidents` in `src/api/fixtures/handlers/
      incidentsList.ts` (kpiTile drill-down param supported now; funnel/breakdown/candidate
      drill-downs added by US3/US4)
- [X] T070 [P] [US1] [REQ PRD §D1-D6,P-4 / FR-058,FR-059,FR-060,FR-061,FR-062,FR-063,FR-064,FR-065,FR-066,FR-067,FR-068,FR-069,FR-070,FR-071,FR-072,FR-118] Implement
      `src/api/incidents/detail.ts`: `GET /api/incidents/:id` plus the lazy sub-fetches (agent-run
      io, similarity-matches show-all, events with `agentOnly`) — none fetched until expanded
      (FR-118)
- [X] T071 [P] [US1] MSW handlers for `GET /api/incidents/:id` and its lazy sub-endpoints in
      `src/api/fixtures/handlers/incidentsDetail.ts`
- [X] T072 [US1] Register the US1 handlers in `src/api/fixtures/handlers/index.ts`

### Components for User Story 1

- [X] T073 [US1] [REQ FR-027,P-2] Implement `src/components/kpi/KpiStrip.now.tsx`: one
      TanStack Query against `dashboard/now`, `PanelBoundary`-wrapped (analyze finding F2: each
      tab's KPI strip is its own file, not three tasks colliding on one `KpiStrip.tsx` path —
      matches the already-distinct test file names)
- [X] T074 [US1] [REQ FR-027,FR-028,FR-029,FR-030,A11Y-1] Implement `src/components/kpi/KpiTile.tsx`: value +
      delta via `domain/kpi.ts`, urgent/cautionary styling, click → `useUrlState` filter
- [X] T075 [US1] [REQ IT-1,IT-2,IT-3,IT-4,IT-5,P-3 / FR-048,FR-049,FR-050,FR-051,FR-052,FR-053,FR-054] Implement `src/components/incidents/
      IncidentTable.tsx`: one TanStack Query, server-side sort/search/page/includeResolved,
      `PanelBoundary`-wrapped, disambiguates empty-no-data vs. empty-filtered
- [X] T076 [US1] [REQ IT-1,IT-6,A11Y-1 / FR-049,FR-054,FR-055,FR-056] Implement `src/components/incidents/
      IncidentRow.tsx`: age via `domain/age.ts` + `AgePill`, source-badge icon in the title cell,
      escalated/non-prod styling, click → drawer via `useUrlState`
- [X] T077 [US1] [REQ PRD §7,A11Y-3 / FR-058,FR-059] Implement `src/components/incidents/
      IncidentDetailDrawer.tsx`: slide-over + scrim, `Esc`/outside-click close, `useFocusTrap`,
      `?incident=` sync via `useUrlState`, one TanStack Query
- [X] T078 [US1] [REQ PRD §D1 / FR-060,FR-061,FR-062] Implement `src/components/incidents/
      IncidentHeaderActions.tsx`: header fields (FR-060) plus the four mutation controls rendered
      **disabled with the reason stated**, per contracts/incidents-endpoints.md's undefined-PATCH
      gap (FR-062) — this disabled state is the real, tested behavior, not a placeholder
- [X] T079 [US1] [REQ PRD §D2 / FR-063] Implement `src/components/incidents/
      ClassificationPanel.tsx`: "AI said X → human corrected to Y" side-by-side when a correction
      exists
- [X] T080 [US1] [REQ PRD §D3,§11.6 / FR-064,FR-065] Implement `src/components/incidents/
      AgentRunTrace.tsx`: ordered by `startedAt`, `FAILED` expanded by default, lazy input/output
      fetch on expand
- [X] T081 [US1] [REQ PRD §D4 / FR-066] Implement `src/components/incidents/
      SimilarityMatchList.tsx`: capped at 5 + lazy "show all"
- [X] T082 [US1] [REQ PRD §D5 / FR-067] Implement `src/components/incidents/
      ActionsAndExecutions.tsx`: read-only rendering (type, risk, confidence, status, duration,
      collapsed payload/logs); approve/reject wiring for any still-`PROPOSED` action is added in
      US2 per FR-068
- [X] T083 [US1] [REQ PRD §D6,TL-1,TL-2,TL-3 / FR-069,FR-070,FR-071,FR-072] Implement `src/components/incidents/
      EventTimeline.tsx`: server-side `agentOnly` re-fetch, failure-event flags, cumulative
      elapsed via `domain/timeline.ts`

**Checkpoint**: User Story 1 fully functional and independently testable — quickstart.md steps 1–3,
7–8 (read-only parts), 11 pass.

---

## Phase 4: User Story 2 - Approve or reject an AI-proposed action (Priority: P2)

**Goal**: The human-in-the-loop gate — approve (with a HIGH-risk confirm step) or reject (with a
required reason) a proposed action, watching it resolve in place, with sibling cards immune to each
other's lifecycle (PRD v2 §11 AC-19).

**Independent Test**: Approve a HIGH-risk action through its confirmation step while a second action
executes; confirm the second's timer is undisturbed; reject a third without a reason and confirm
it's refused; double-click Approve and confirm exactly one execution; confirm the queue is reachable
from the alert strip on any tab.

### Tests for User Story 2 (MANDATORY — write first) ⚠️

- [X] T084 [P] [US2] [REQ AR-5,AR-6,AR-7,AR-8,§11.2,§11.3,§11.9 / FR-037,FR-038,FR-039,FR-040,FR-041,FR-042,FR-043,FR-044,FR-045] Contract test for
      `POST /api/actions/:id/approve` and `/reject` (`confirmedHighRisk` gate, empty-reason 400,
      `409` reconciliation) in `src/api/approvals/actions.contract.test.ts`
- [X] T085 [P] [US2] [REQ AR-9,AR-10 / FR-031,FR-032,FR-046] Contract test for
      `GET /api/approvals/pending` (excludes `approval_required=false`, sort order, empty-state
      count) in `src/api/approvals/pending.contract.test.ts`
- [X] T086 [P] [US2] [REQ AR-7 / FR-040,FR-041] Contract test for
      `GET /api/actions/:id/execution` polling shape in
      `src/api/approvals/execution.contract.test.ts`
- [X] T087 [P] [US2] [REQ AR-1,AR-2,AR-3,AR-4] Component test for `ApprovalCard`: risk badge with
      text label, confidence bar + low-confidence caption, parameters collapsed/expand, "why this
      action" evidence, in `src/components/approvals/ApprovalCard.test.tsx`
- [X] T088 [P] [US2] [REQ AR-5,§11.2] Component test for `ApproveConfirmModal`: HIGH requires the
      second click, LOW/MEDIUM skip it entirely, focus trapped while open, in
      `src/components/approvals/ApproveConfirmModal.test.tsx`
- [X] T089 [P] [US2] [REQ AR-6,§11.3] Component test for `RejectForm`: empty reason refused,
      optional corrections accepted, successful submit writes feedback, in
      `src/components/approvals/RejectForm.test.tsx`
- [X] T090 [P] [US2] [REQ X-4,§11.9,SC-006 / FR-044] Component test:
      double-click/repeat-activation on `ApprovalCard`'s Approve triggers exactly one request, in
      `src/components/approvals/ApprovalCard.idempotency.test.tsx`
- [X] T091 [P] [US2] [REQ FR-041] Component test: `ApprovalCard` switches to "still running" at
      the 2-minute bound (injected clock), never reports a failure it hasn't observed, in
      `src/components/approvals/ApprovalCard.timeout.test.tsx`
- [X] T092 [P] [US2] [REQ X-1 / FR-045] Component test: a failed approve/reject rolls the
      optimistic UI back and surfaces the error, in
      `src/components/approvals/ApprovalCard.rollback.test.tsx`
- [X] T093 [P] [US2] [REQ §11.19 / FR-042] Component test: with two cards approved and executing,
      rejecting a third and letting the queue re-render leaves both executing cards' elapsed timers
      and poll subscriptions completely undisturbed — mount-count and timer-identity assertions,
      not just visual state — in `src/components/approvals/ApprovalQueue.siblingSurvival.test.tsx`
- [X] T094 [P] [US2] [REQ FR-120] Component test: `OperatorNamePrompt` blocks the triggering
      action's completion until a name is supplied, in
      `src/components/approvals/OperatorNamePrompt.test.tsx`
- [X] T095 [P] [US2] [REQ SC-001,SC-006,SC-007 / FR-011,FR-047] Playwright e2e: full flow —
      approve LOW in one click, approve HIGH through confirm, reject without a reason is refused,
      reject with one succeeds, and the queue is reached via the alert strip's button from the
      Performance tab — in `tests/e2e/approvalFlow.spec.ts`
- [X] T096 [P] [US2] [REQ §11.19,SC-006] Playwright e2e: approve two actions, reject a third while
      the first two run — confirm both running cards' visible elapsed timers keep advancing
      without a visual reset, in `tests/e2e/siblingCardSurvival.spec.ts`
- [X] T097 [P] [US2] [REQ A11Y-3,SC-009] Playwright e2e: keyboard-only traversal of the approval
      queue (`Tab`, `Enter`, `Esc`) in `tests/e2e/approvalKeyboard.spec.ts`

### Domain for User Story 2

- [X] T098 [US2] [REQ AR-6 / Assumption 6] Implement `src/domain/rejection.ts`: maps a reject
      form's reason + optional corrections to the `DeveloperFeedback` request shape (reason
      travels via `comments`, per data-model.md's rejection-reason gap note)
- [X] T099 [US2] Unit test for `domain/rejection.ts` mapping in `src/domain/rejection.test.ts`

### API + MSW for User Story 2

- [X] T100 [P] [US2] [REQ FR-031,FR-032,AR-9,AR-10] Implement `src/api/approvals/pending.ts`
- [X] T101 [P] [US2] MSW handler for `GET /api/approvals/pending` in `src/api/fixtures/handlers/
      approvalsPending.ts` — excludes `approval_required=false` at the fixture level
- [X] T102 [P] [US2] [REQ AR-5,AR-8,X-4 / FR-037,FR-043,FR-044] Implement `src/api/approvals/
      approve.ts`: TanStack `useMutation` keyed by action id, `actor` sourced from
      `OperatorContext`
- [X] T103 [P] [US2] [REQ AR-6,AR-8 / FR-038,FR-039,FR-043] Implement `src/api/approvals/
      reject.ts`
- [X] T104 [P] [US2] MSW handlers for the approve/reject `POST`s, including `409`/`400` simulation
      paths, in `src/api/fixtures/handlers/approvalsActions.ts`
- [X] T105 [P] [US2] [REQ AR-7 / FR-040,FR-041] Implement `src/api/approvals/execution.ts`:
      polling query, fast cadence switching to the slower one at the 2-minute bound, keyed by
      action id so one card's poll cannot affect another's (FR-042)
- [X] T106 [P] [US2] MSW handler for `GET /api/actions/:id/execution` in `src/api/fixtures/
      handlers/approvalsExecution.ts`
- [X] T107 [US2] Register the US2 handlers in `src/api/fixtures/handlers/index.ts`

### Components for User Story 2

- [X] T108 [US2] [REQ AR-9,P-2 / FR-031,FR-032,FR-046,FR-047] Implement `src/components/approvals/
      ApprovalQueue.tsx`: one TanStack Query, positive empty state, `PanelBoundary`-wrapped,
      renders every card keyed by `id` — **never by array index** (FR-042)
- [X] T109 [US2] [REQ AR-1,AR-2,AR-3,AR-4,X-1,X-4 / FR-040,FR-041,FR-044,FR-045] Implement
      `src/components/approvals/ApprovalCard.tsx`
- [X] T110 [US2] [REQ AR-5,A11Y-3 / FR-037] Implement `src/components/approvals/
      ApproveConfirmModal.tsx` using `useFocusTrap`
- [X] T111 [US2] [REQ AR-6 / FR-038,FR-039] Implement `src/components/approvals/RejectForm.tsx`
      with React Hook Form
- [X] T112 [US2] [REQ AR-3,P-4 / FR-035] Implement `src/components/approvals/
      ParametersViewer.tsx`: dynamic `import()` of `sql-formatter` + the regex tokenizer on first
      expand only (research.md §8)
- [X] T113 [US2] [REQ AR-4 / FR-036] Implement `src/components/approvals/WhyThisAction.tsx`
- [X] T114 [US2] [REQ FR-120] Implement `src/components/approvals/OperatorNamePrompt.tsx`,
      wired to `OperatorContext`
- [X] T115 [US2] [REQ PRD §D5 / FR-068] Wire `ActionsAndExecutions.tsx` (built in US1) to reuse
      `ApprovalCard`'s approve/reject behavior for any still-`PROPOSED` action found in the drawer

**Checkpoint**: US1 + US2 independently functional. This is PRD §12's phases 1–2 — "a coherent,
demoable product" per the PRD's own words — now with the alert strip and tab shell already in place
from Foundational.

---

## Phase 5: User Story 3 - See the automation trust argument, with drill-downs that explain themselves (Priority: P3)

**Goal**: Performance tab's three automation tiles, the funnel, and execution outcomes, plus the
cross-tab jump mechanism every later drill-down (breakdowns in US5) will reuse.

**Independent Test**: Verify each Performance tile, funnel stage, and outcome count independently;
confirm rolled-back is never folded into success/failure; click a funnel stage and confirm the
dashboard switches to Now, flashes the table, shows a distinctly-styled chip, toasts, and the row
count matches the stage's drop count; confirm clearing the chip stays on Now.

### Tests for User Story 3 (MANDATORY — write first) ⚠️

- [X] T116 [P] [US3] [REQ N1b,P2,§6.1 / FR-080,FR-081,FR-082,FR-083,FR-084,FR-085,FR-086,FR-087,FR-088,FR-089,§11.4] Contract test for
      `GET /api/dashboard/performance` (tile shapes, stage/`dropCount` semantics, the
      automation-rate split, outcomes block) in `src/api/dashboard/performance.contract.test.ts`
- [X] T117 [P] [US3] [REQ PRD §B1 / FR-083,FR-084] Unit test for `domain/funnel.ts`:
      percentage-of-stage-above + automatic largest-drop annotation, in
      `src/domain/funnel.test.ts`
- [X] T118 [P] [US3] [REQ §11.4 / FR-085,FR-086,FR-087,FR-088] Unit test for `domain/funnel.ts` drop-set selection,
      including the zero-loss stage and the first-stage (no drop-set) edge cases, in
      `src/domain/funnel.dropset.test.ts`
- [X] T119 [P] [US3] [REQ FR-025,FR-026,XT-1,XT-2,XT-3,XT-4,XT-5 / FR-021,FR-022,FR-023,FR-024] Unit test for the cross-tab jump
      state machine in `domain/filters.ts` (extended here): switching tab + applying a filter is
      one atomic transition; clearing never changes the active tab, in
      `src/domain/filters.crossTab.test.ts`
- [X] T120 [P] [US3] [REQ N1b / FR-081] Unit test for `domain/kpi.ts`'s median null-guard/no-value
      formatting (extended here for Performance's median-resolve tile; zero-resolved-incidents
      edge case) in `src/domain/kpi.median.test.ts`
- [X] T121 [P] [US3] [REQ N1b] Component test for `KpiStrip` (Performance variant): three tiles,
      median (not average) headline value with average in tooltip, in
      `src/components/kpi/KpiStrip.performance.test.tsx`
- [X] T122 [P] [US3] [REQ PRD §B1,§11.4 / FR-083,FR-084,FR-085,FR-086,FR-087,FR-088] Component test for `AutomationFunnel`:
      stage rendering, cross-tab jump on click, filtered-empty (not no-data) on a zero-loss stage,
      in `src/components/charts/AutomationFunnel.test.tsx`
- [X] T123 [P] [US3] [REQ §6.1 / FR-089] Component test: fully-automated/human-assisted always
      render as two separate numbers, never merged, in
      `src/components/charts/AutomationFunnel.rate.test.tsx`
- [X] T124 [P] [US3] [REQ XT-1,XT-2,XT-3,XT-4,§11.15 / FR-021,FR-022,FR-023] Component test for
      `useCrossTabJump`/`CrossTabFilterChip`/`CrossTabToast`: clicking a Performance tile or funnel
      stage switches to Now, flashes and scrolls the table into view, renders a distinctly-styled
      chip, and fires a toast naming the jump, in `src/state/useCrossTabJump.test.tsx`
- [X] T125 [P] [US3] [REQ XT-5,§11.16 / FR-024] Component test: clearing a cross-tab chip clears
      the filter without navigating back to the originating tab, in
      `src/components/shared/CrossTabFilterChip.test.tsx`
- [X] T126 [P] [US3] [REQ EO-1,SC-008 / FR-090,FR-091] Component test for
      `ExecutionOutcomeDonut`: rolled-back is always its own bucket, in
      `src/components/charts/ExecutionOutcomeDonut.test.tsx`
- [X] T127 [P] [US3] [REQ EO-2,EO-3,EO-4 / FR-092,FR-093,FR-094] Component test for
      `ExecutionOutcomeDonut`: recent-failures list, by-action-type toggle, median-duration
      caption, in `src/components/charts/ExecutionOutcomeDonut.details.test.tsx`
- [X] T128 [P] [US3] [REQ A11Y-4] Component test: `AccessibleChartTable` integration for both
      Performance charts built in this story, in `src/components/charts/chartsAccessibility.test.tsx`
- [X] T129 [P] [US3] [REQ SC-005,SC-014,§11.4,§11.5,§11.15 / FR-085,FR-086] Playwright e2e: a
      funnel drop-set click's row count exactly matches its displayed drop count after the
      cross-tab jump; rolled-back never appears folded into failed; the jump is legible without
      documentation (flash + chip + toast all present), in
      `tests/e2e/funnelReconciliation.spec.ts`

### Domain for User Story 3

- [X] T130 [P] [US3] [REQ PRD §B1 / FR-083,FR-084,FR-085,FR-086,FR-087,FR-088] Implement `src/domain/funnel.ts`:
      percentage-of-above, largest-drop annotation, drop-set selection (incl. FR-087/FR-088 edge
      cases)
- [X] T131 [US3] [REQ FR-025,FR-026 / XT-1,XT-2,XT-3,XT-4,XT-5] Extend `src/domain/filters.ts` (built in
      Foundational) with the cross-tab jump transition: switch-tab + apply-filter as one state
      update, distinct from a same-tab filter change
- [X] T132 [US3] [REQ N1b / FR-081] Extend `src/domain/kpi.ts` (built in US1) with the
      median-resolve null-guard/no-value formatting Performance's tiles need

### API + MSW for User Story 3

- [X] T133 [P] [US3] [REQ FR-080,FR-081,FR-082,FR-083,FR-084,FR-085,FR-086,FR-087,FR-088,FR-089,FR-090,FR-091,FR-092,FR-093,FR-094] Implement `src/api/dashboard/performance.ts`
- [X] T134 [P] [US3] MSW handler for `GET /api/dashboard/performance` in `src/api/fixtures/
      handlers/dashboardPerformance.ts` — seeded with the PRD's 142/98/87/79/71/68,
      `validatedResolved` returned as unavailable per Assumption 5
- [X] T135 [US3] Register the US3 handlers in `src/api/fixtures/handlers/index.ts`; extend
      `src/api/fixtures/handlers/incidentsList.ts` to honor `funnelDropAt`/`funnelStage`/
      Performance `kpiTile` values

### Components for User Story 3

- [X] T136 [P] [US3] [REQ XT-1,XT-2,XT-3,XT-4 / FR-021,FR-022,FR-023] Implement `src/state/
      useCrossTabJump.ts`: the single call site for switch-tab + apply-filter + flash + scroll +
      toast, consumed by every Performance/Knowledge drill-down click
- [X] T137 [P] [US3] [REQ XT-3,XT-5 / FR-022,FR-024,FR-026] Implement `src/components/shared/
      CrossTabFilterChip.tsx` and `src/components/shared/CrossTabToast.tsx`
- [X] T138 [US3] [REQ N1b,P-2 / FR-080,FR-081,FR-082] Implement
      `src/components/kpi/KpiStrip.performance.tsx`: one TanStack Query against
      `dashboard/performance`'s `tiles` block,
      clicks routed through `useCrossTabJump`
- [X] T139 [US3] [REQ PRD §B1,P-2 / FR-083,FR-084,FR-085,FR-086,FR-087,FR-088] Implement `src/components/charts/
      AutomationFunnel.tsx`: hand-rolled stage rows, click → `useCrossTabJump`,
      `PanelBoundary`-wrapped
- [X] T140 [US3] [REQ §6.1 / FR-089] Implement the fully-automated/human-assisted two-number
      display within `AutomationFunnel.tsx`
- [X] T141 [US3] [REQ EO-1,EO-2,EO-3,EO-4 / FR-090,FR-091,FR-092,FR-093,FR-094] Implement `src/components/charts/
      ExecutionOutcomeDonut.tsx`: Recharts `Pie`, rolled-back as its own slice + count,
      by-type toggle, recent failures, median duration
- [X] T142 [US3] [REQ A11Y-4] Wire `AccessibleChartTable` into both `AutomationFunnel` and
      `ExecutionOutcomeDonut`

**Checkpoint**: US1 + US2 + US3 independently functional — PRD §12 phase 3, "the trust argument,"
plus the cross-tab jump machinery US5 will reuse without rebuilding.

---

## Phase 6: User Story 4 - Find where the AI has nothing to work with, and see the effect of fixing it (Priority: P4)

**Goal**: The Knowledge tab (coverage gaps, documents driving resolutions, documentation
candidates) and the feedback-impact widget — closing the learning loop, per the PRD's own framing
of these two as one phase.

**Independent Test**: Verify the three Knowledge tiles, the coverage-gap ordering and caption, the
documents-driving-resolutions ranking, and the documentation-candidates list with recurrence counts;
verify the feedback-impact widget computes a real percentage, is suppressed under the 10-correction
threshold, and never attributes a decline to the user.

### Tests for User Story 4 (MANDATORY — write first) ⚠️

- [X] T143 [P] [US4] [REQ K1,K2,K3 / FR-099,FR-100,FR-101,FR-102] Contract test for `GET /api/dashboard/knowledge`
      (tile shapes, ascending coverage-gap order, descending document ranking) in
      `src/api/dashboard/knowledge.contract.test.ts`
- [X] T144 [P] [US4] [REQ K4 / FR-103,FR-104] Contract test for `GET /api/incidents?candidate=true`
      (candidateReason/recurrenceCount population) in
      `src/api/incidents/candidates.contract.test.ts`
- [X] T145 [P] [US4] [REQ FI-1 / FR-075] Contract test for `GET /api/feedback/impact` (ignores any
      `from`/`to` passed; `suppressed` flag; personal vs. team shape) in
      `src/api/feedbackImpact.contract.test.ts` (analyze finding F1: flat filename, sibling to
      `api/feedback.ts`, not a `feedback/` directory)
- [X] T146 [P] [US4] [REQ K2 / FR-100,FR-101] Unit test for `domain/coverageGaps.ts`: ascending
      sort by known-rate, highest-leverage-fix caption selection, in
      `src/domain/coverageGaps.test.ts`
- [X] T147 [P] [US4] [REQ FI-1,§14 (spec.md Assumption 14) / FR-075] Unit test for
      `domain/feedbackAccuracy.ts`: denominator = incidents with any feedback; numerator = no
      recorded disagreement; incidents with no feedback excluded entirely; in
      `src/domain/feedbackAccuracy.test.ts`
- [X] T148 [P] [US4] [REQ FI-4,§11.20 / FR-077] Unit test for `domain/feedbackAccuracy.ts`'s
      suppression boundary — exactly 9 team-wide corrections suppresses, exactly 10 does not — in
      `src/domain/feedbackAccuracy.suppression.test.ts`
- [X] T149 [P] [US4] [REQ K1] Component test for `KpiStrip` (Knowledge variant): three tiles, in
      `src/components/kpi/KpiStrip.knowledge.test.tsx`
- [X] T150 [P] [US4] [REQ K2] Component test for `CoverageGapsChart`: ascending order (not
      volume), red/amber/green thresholds, explicit named caption, in
      `src/components/charts/CoverageGapsChart.test.tsx`
- [X] T151 [P] [US4] [REQ K3 / FR-102] Component test for `DocumentsDrivingResolutions`: ranked by
      resolution count, in `src/components/charts/DocumentsDrivingResolutions.test.tsx`
- [X] T152 [P] [US4] [REQ K4] Component test for `DocumentationCandidates`: recurrence count shown
      only when > 1, row click opens the drawer identically to `IncidentRow`, in
      `src/components/charts/DocumentationCandidates.test.tsx`
- [X] T153 [P] [US4] [REQ FI-1,FI-2,FI-3,FI-4,FI-5,§11.20,SC-015 / FR-074,FR-077,FR-078,FR-079]
      Component test for `FeedbackImpactWidget`: renders accuracy + prior value + personal count +
      team-quarter total when not suppressed; renders nothing at all when suppressed; decline copy
      never blames the user; no ranking/badge/streak element exists anywhere in its markup, in
      `src/components/incidents/FeedbackImpactWidget.test.tsx`
- [X] T154 [P] [US4] [REQ PRD §D7 / FR-073] Component test for `FeedbackForm`: type + comments
      required, optional corrections, existing feedback listed above the form (and below the
      impact widget), in `src/components/incidents/FeedbackForm.test.tsx`
- [X] T155 [P] [US4] [REQ SC-004] Playwright e2e: a runbook owner reads the coverage-gap caption
      and can state the single highest-leverage fix without additional inference, in
      `tests/e2e/knowledgeView.spec.ts`

### Domain for User Story 4

- [X] T156 [P] [US4] [REQ K2 / FR-100,FR-101] Implement `src/domain/coverageGaps.ts`: ascending
      sort + highest-leverage-fix caption selection
- [X] T157 [P] [US4] [REQ FI-1 / FR-075,FR-076] Implement `src/domain/feedbackAccuracy.ts`: the
      agreement-rate computation (spec.md Assumption 14) and the suppression check (FR-077)

### API + MSW for User Story 4

- [X] T158 [P] [US4] [REQ FR-099,FR-100,FR-101,FR-102] Implement `src/api/dashboard/knowledge.ts`
- [X] T159 [P] [US4] MSW handler for `GET /api/dashboard/knowledge` in `src/api/fixtures/
      handlers/dashboardKnowledge.ts`
- [X] T160 [P] [US4] [REQ FR-075,FR-076] Implement `src/api/feedbackImpact.ts` (analyze finding
      F1: flat filename — see T195 for why this can't be `feedback/impact.ts`)
- [X] T161 [P] [US4] MSW handler for `GET /api/feedback/impact` in `src/api/fixtures/handlers/
      feedbackImpact.ts` — ignores any `from`/`to` query params it's passed, per the contract
- [X] T194 [P] [US4] [REQ PRD §D7 / FR-073] Contract test for `POST /api/incidents/:id/feedback`
      (analyze finding E1 — this endpoint is fully specified in contracts/feedback-endpoint.md but
      had zero covering tasks) in `src/api/feedback.contract.test.ts`. Numbered out of sequence to
      avoid renumbering T001–T193; logically part of "API + MSW for User Story 4," write before
      T195.
- [X] T195 [P] [US4] [REQ PRD §D7 / FR-073] Implement `src/api/feedback.ts`: the
      `POST /api/incidents/:id/feedback` client `FeedbackForm` (T170) calls — a flat file, sibling
      to `feedbackImpact.ts` (T160), not a `feedback/` directory (analyze finding F1)
- [X] T196 [P] [US4] MSW handler for `POST /api/incidents/:id/feedback` in
      `src/api/fixtures/handlers/feedback.ts`
- [X] T162 [US4] Extend `src/api/fixtures/handlers/incidentsList.ts` to honor `candidate=true`
      (K4) with real `candidateReason`/`recurrenceCount` values from the fixture data
- [X] T163 [US4] Register the US4 handlers in `src/api/fixtures/handlers/index.ts`, including
      T196's feedback-write handler alongside T159/T161's

### Components for User Story 4

- [X] T164 [US4] [REQ K1,P-2] Implement `src/components/kpi/KpiStrip.knowledge.tsx`: one
      TanStack Query against `dashboard/knowledge`'s tiles
- [X] T165 [US4] [REQ K2] Implement `src/components/charts/CoverageGapsChart.tsx`: hand-rolled
      horizontal bars, ascending, red/amber/green thresholds, auto-caption via `domain/
      coverageGaps.ts`
- [X] T166 [US4] [REQ K3 / FR-102] Implement `src/components/charts/
      DocumentsDrivingResolutions.tsx`
- [X] T167 [US4] [REQ K4] Implement `src/components/charts/DocumentationCandidates.tsx`: consumes
      `GET /api/incidents?candidate=true`, reuses `IncidentRow`'s click-opens-drawer behavior
- [X] T168 [US4] [REQ A11Y-4 / FR-114] Wire `AccessibleChartTable` into `CoverageGapsChart` and
      `DocumentsDrivingResolutions`
- [X] T169 [US4] [REQ FI-1,FI-2,FI-3,FI-4,FI-5,§11.20 / FR-074,FR-077,FR-078,FR-079] Implement
      `src/components/incidents/FeedbackImpactWidget.tsx`: one TanStack Query against
      `feedback/impact`; renders nothing
      when `suppressed`; static, model-attributed copy on any decline (FR-078); no per-user
      ranking anywhere (FR-079)
- [X] T170 [US4] [REQ PRD §D7 / FR-073] Implement `src/components/incidents/FeedbackForm.tsx`
      with React Hook Form, submitting via `api/feedback.ts` (T195), listing existing feedback
      above the form and below
      `FeedbackImpactWidget`

**Checkpoint**: US1–US4 independently functional — PRD §12 phase 4, "closes the learning loop."

---

## Phase 7: User Story 5 - See volume trends and where incidents concentrate (Priority: P5)

**Goal**: Volume trend with resolution-time overlay and the three breakdown charts, reusing US3's
cross-tab jump machinery rather than rebuilding it.

**Independent Test**: Verify the volume buckets and overlay series and the three breakdowns; verify
clicking any segment produces the same cross-tab jump behaviour as a funnel stage.

### Tests for User Story 5 (MANDATORY — write first) ⚠️

- [X] T171 [P] [US5] [REQ P4,P5 / FR-095,FR-096,FR-097,FR-098] Contract test for `GET /api/dashboard/breakdowns`
      (volume bucket granularity, top-6+Other, top-5 services) in
      `src/api/dashboard/breakdowns.contract.test.ts`
- [X] T172 [P] [US5] [REQ P4 / FR-095 / Assumption 4] Component test for `VolumeChart`: day
      buckets for 7d/30d/All, hour buckets for 24h, in
      `src/components/charts/VolumeChart.test.tsx`
- [X] T173 [P] [US5] [REQ P4 / FR-096] Component test for `VolumeChart`: median-resolution line
      overlaid on a secondary axis, in `src/components/charts/VolumeChart.overlay.test.tsx`
- [X] T174 [P] [US5] [REQ P5 / FR-097,FR-098] Component test for `BreakdownBars` (all three
      variants): ordering, top-N+Other, inline known-rate, cross-tab jump on click via
      `useCrossTabJump` (built in US3), in `src/components/charts/BreakdownBars.test.tsx`
- [X] T175 [P] [US5] [REQ SC-004] Playwright e2e: a breakdown-segment click produces the identical
      cross-tab jump sequence (switch, flash, chip, toast) as a funnel-stage click, in
      `tests/e2e/breakdownCrossTabJump.spec.ts`

### Domain for User Story 5

- [X] T176 [P] [US5] [REQ P4 / FR-095 / Assumption 4] Implement `src/domain/volumeBuckets.ts`:
      bucket granularity selection by active time range

### API + MSW for User Story 5

- [X] T177 [P] [US5] [REQ FR-095,FR-096,FR-097] Implement `src/api/dashboard/breakdowns.ts`
- [X] T178 [P] [US5] MSW handler for `GET /api/dashboard/breakdowns` in `src/api/fixtures/
      handlers/dashboardBreakdowns.ts`
- [X] T179 [US5] Extend `src/api/fixtures/handlers/incidentsList.ts` to honor `breakdown=`
- [X] T180 [US5] Register the US5 handlers in `src/api/fixtures/handlers/index.ts`

### Components for User Story 5

- [X] T181 [US5] [REQ P4,P-2 / FR-095,FR-096] Implement `src/components/charts/
      VolumeChart.tsx`: Recharts `ComposedChart`, stacked known/unknown + median-resolve line
- [X] T182 [US5] [REQ P5 / FR-097,FR-098] Implement `src/components/charts/
      BreakdownBars.tsx` (parameterized for priority/category/service), click → `useCrossTabJump`
- [X] T183 [US5] [REQ A11Y-4] Wire `AccessibleChartTable` into `VolumeChart` and `BreakdownBars`

**Checkpoint**: All five user stories independently functional — full PRD v2.0 scope (§12 phases
1–5).

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verification passes that span every story — PRD §12 phase 5's remaining "ship quality"
scope (Knowledge and breakdowns/volume having already absorbed the content PRD v2 explicitly moved
ahead of pure polish).

- [X] T184 [P] [REQ P-1 / FR-115] Measure first-meaningful-paint against the seeded dataset
      (Lighthouse or equivalent); confirm < 2s
- [X] T185 [P] [REQ X-2,X-3 / FR-108,FR-109] Verify the alert strip's 30s cadence and Performance/
      Knowledge's 5-minute cadence via each query's `refetchInterval`; confirm animated,
      non-jumping value transitions across every tile/chart
- [X] T186 [P] [REQ TB-4 / FR-019] Playwright e2e: switching between all three tabs after initial
      load triggers no additional network request for already-loaded panels and no loading
      skeleton, in `tests/e2e/tabSwitchNoRefetch.spec.ts`
- [X] T187 [P] [REQ §11.12,SC-012,SC-013 / FR-015] Playwright e2e: record the alert strip's counts,
      switch to Performance, seed a new P1, confirm the strip updates within one polling interval
      with no tab switch or manual refresh (SC-013), and confirm the counts read identically
      whichever tab is active except for that update itself (SC-012), in
      `tests/e2e/stripLiveness.spec.ts`
- [X] T188 [P] [REQ A11Y-2 / FR-112] Run an automated contrast check (e.g. `axe`) across every
      pill/badge and chart series; fix any WCAG AA failure found
- [X] T189 [P] [REQ A11Y-3,SC-009 / FR-113] Playwright e2e: full keyboard traversal of the tab
      bar, the open drawer (agent trace, similarity matches, actions, timeline, feedback), in
      `tests/e2e/drawerKeyboard.spec.ts`
- [X] T190 [P] [REQ Principle VIII,SC-011 / FR-106] Playwright e2e: force one panel's MSW handler
      to error (including the alert strip itself) and confirm every other panel stays interactive,
      in `tests/e2e/failureIsolation.spec.ts`
- [X] T191 [REQ quickstart.md] Walk quickstart.md's 11-step manual golden-path check end-to-end;
      record the result
- [X] T192 [P] Document `npm run dev`/`test`/`test:e2e` in `README.md` per quickstart.md
- [X] T193 Run `npm run typecheck` and `npm run lint` clean across `src/`; fix any strict-mode or
      lint violation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: complete
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**. Now includes the
  alert strip and tab shell, since PRD v2 itself treats both as prerequisites for every later
  decision, and US2 depends on the strip's button existing.
- **User Stories (Phase 3–7)**: all depend on Foundational; mostly independent of each other, with
  two real cross-story dependencies (below), both additive
- **Polish (Phase 8)**: depends on all five user stories

### User Story Dependencies

- **US1 (P1)**: no dependency on US2/US3/US4/US5
- **US2 (P2)**: builds `ApprovalCard` independently of US1, but its final task (T115) wires into
  US1's `ActionsAndExecutions.tsx` — additive, US1 works with or without it
- **US3 (P3)**: no dependency on US1/US2/US4; **US5 depends on US3** for `useCrossTabJump`/
  `CrossTabFilterChip`/`CrossTabToast` (built once in US3, reused, not rebuilt)
- **US4 (P4)**: no dependency on US1/US2/US3/US5 — Knowledge's own charts (K2/K3) are not
  drill-down targets, so US4 needs none of US3's cross-tab machinery
- **US5 (P5)**: depends on US3 (see above); otherwise independent

### The shared-file caveats

- Every story's last task registers its MSW handlers into `src/api/fixtures/handlers/index.ts`
  (T072, T107, T135, T163, T180) — one-line, low-conflict, sequence if worked in parallel.
- `src/api/fixtures/handlers/incidentsList.ts` gains an additive branch from US1 (base), US3
  (`funnelDropAt`/`funnelStage`/Performance `kpiTile`), US4 (`candidate=true`), and US5
  (`breakdown=`) — four stories touch one file across the project's lifetime, each adding a
  self-contained branch.
- `src/domain/filters.ts` and `src/domain/kpi.ts` are each created in Foundational/US1 and
  **extended** (not recreated) by US3 (T131, T132) — a real but small cross-story file dependency,
  called out explicitly in those tasks' descriptions rather than left implicit.

### Within Each User Story

- Tests are written first and MUST fail before implementation begins (Constitution XII)
- Domain modules before the API layer that composes them
- API + MSW before the components that consume them
- Story complete and independently demoable before moving to the next priority

### Parallel Opportunities

- All Foundational `[P]` tasks run together, respecting the few intra-phase orderings noted (e.g.
  `useUrlState` needs `domain/filters.ts` first; `AlertStrip`'s component task follows its own API
  task)
- Once Foundational is done, **US1, US2, US3, and US4 can all start in parallel** — US5 must wait
  for US3's `useCrossTabJump` to exist
- Within a story, every test task is `[P]` against every other test task in that story

---

## Parallel Example: User Story 3

```bash
# All US3 tests together (T116-T129), before any US3 implementation:
Task: "Contract test for GET /api/dashboard/performance in src/api/dashboard/performance.contract.test.ts"
Task: "Unit test for domain/funnel.ts percentage/annotation in src/domain/funnel.test.ts"
Task: "Component test for AutomationFunnel in src/components/charts/AutomationFunnel.test.tsx"
# ...remaining T116-T129

# Cross-tab jump machinery, built once here and reused by US5 (T130, T136, T137):
Task: "Implement src/domain/funnel.ts"
Task: "Implement src/state/useCrossTabJump.ts"
Task: "Implement src/components/shared/CrossTabFilterChip.tsx + CrossTabToast.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup — done
2. Phase 2: Foundational (alert strip + tab shell) — **critical, blocks everything**
3. Phase 3: User Story 1
4. **Stop and validate**: run quickstart.md steps 1–3, 7–8, 11 against the seeded dataset
5. This alone proves the data model end to end *and* that the strip never regresses — PRD §12
   phase 1's own stated rationale for building the strip first, not last

### Incremental Delivery

1. Setup + Foundational → foundation ready (strip + tabs already correct)
2. + US1 → demoable read-only dashboard (MVP)
3. + US2 → PRD §12's "coherent, demoable product" (phases 1–2) — the demo moment
4. + US3 → "the trust argument" (phase 3), plus the cross-tab jump machinery
5. + US4 → closes the learning loop (phase 4)
6. + US5 → full PRD scope (phase 5)
7. + Polish → ship quality

### Parallel Team Strategy

Once Foundational is done: one person on US1, US2, and US4 each in parallel; US3 first, then US5
(same person or handed off), since US5 depends on US3's cross-tab jump hook. Coordinate on the
shared-file caveats above.

---

## Notes

- `[P]` = different file, no dependency on an incomplete task
- `[REQ]` = PRD requirement ID(s)/§11 criterion; every FR number from spec.md appears in at least
  one task's description text for direct spec.md traceability (Constitution Principle II)
- Every component task's Definition of Done includes all four states (Principle VII) and the
  accessibility obligations for that surface (Principle X) — not called out as separate tasks per
  component, since the constitution makes them part of every component's completion
- Full per-component contracts (props/states/events/errors) are written immediately before that
  component's implementation task, per the constitution's Definition of Done item 1 —
  component-inventory.md fixed each component's *identity and classification* at plan time; the
  full contract is this task's first sub-step, not a separate task
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently before continuing
