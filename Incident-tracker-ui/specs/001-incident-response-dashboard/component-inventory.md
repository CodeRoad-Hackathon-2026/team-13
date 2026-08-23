# Component Inventory

**Revised for PRD v2.0.** FR numbers match spec.md's post-re-spec numbering. `BandA`/`BandB` from
v1.0 are removed — replaced by `AlertStrip` (persistent, cross-cutting) and `TabBar`/`TabPanel`
(hand-rolled ARIA tabs, research.md §11).

Principle I requires a component contract (props, states, events, errors, loading, empty) before
implementation. At plan time, before any component exists, that contract is only meaningful once a
component's *identity* and *classification* are fixed — this inventory is that fixation. The full
per-component contract (every prop typed, every state enumerated) is written and reviewed at
task-level, per the constitution's Definition of Done item 1, immediately before that component's
code — `/speckit-tasks` generates one task per row below with "write its contract" as the task's
first checklist item.

Classification is one of: **Page**, **Layout**, **Feature Component**, **Shared Component**,
**Form Component**, **UI Primitive** (constitution, Technology Constraints).

## Layout

| Component | Classification | Responsibility |
|---|---|---|
| `App` | Page | Mounts providers (`QueryClientProvider`, `OperatorContext`), the single route, MSW registration in dev. |
| `DashboardHeader` | Layout | Title, environment filter, time range (with the FR-004 tooltip explaining scope), live indicator (§4). Hosts `AlertStrip` beneath it, above `TabBar`. |
| `AlertStrip` | Feature Component | FR-007–FR-015. Own TanStack Query (`GET /api/dashboard/alert-strip`), mounted in the header — never inside a `TabPanel` — so it is unaffected by tab visibility and polls unconditionally (research.md §12). Renders `hot`/`warm`/`calm`, including the calm resting message (FR-010). |
| `TabBar` | Layout | FR-016–FR-017. `role="tablist"`, roving-tabindex arrow-key navigation, badge on Now (FR-018) hidden at zero. Writes the active tab into `useUrlState`. |
| `TabPanel` | Layout | One per tab (Now/Performance/Knowledge), always mounted, visibility toggled via the native `hidden` attribute (FR-019, research.md §11) — never conditionally rendered. |

## Now tab — operational tiles

| Component | Classification | FRs |
|---|---|---|
| `KpiStrip` (Now variant) | Feature Component | FR-027–FR-030. One TanStack Query (`GET /api/dashboard/now`) — Principle VIII isolation boundary. |
| `KpiTile` | UI Primitive | Renders one tile; owns urgent/cautionary styling (FR-029) and its own drill-down click (FR-028, FR-025/FR-026). Shared across Now/Performance/Knowledge tile sets. |

## Now tab — approvals

| Component | Classification | FRs |
|---|---|---|
| `ApprovalQueue` | Feature Component | FR-031, FR-032, FR-046, FR-047. One query (`GET /api/approvals/pending`) — its own isolation boundary. Reachable via a scroll target the alert strip's button flashes into view (FR-011). |
| `ApprovalCard` | Feature Component | FR-033–FR-036, FR-040–FR-045. Owns the approve/reject mutations, **keyed by action id, never by array index** (FR-042 — see contracts/approvals-endpoints.md's note on this exact point). |
| `ApproveConfirmModal` | Form Component | FR-037. Uses `useFocusTrap` (research.md §9). |
| `RejectForm` | Form Component | FR-038, FR-039. React Hook Form; required-reason validation. |
| `ParametersViewer` | Shared Component | FR-035. Dynamically imports the tokenizer + `sql-formatter` (research.md §8) on first expand. |
| `WhyThisAction` | Shared Component | FR-036. |
| `OperatorNamePrompt` | Form Component | FR-120. Modal-like; blocks the triggering action's completion until submitted. |

## Now tab — incident table

| Component | Classification | FRs |
|---|---|---|
| `IncidentTable` | Feature Component | FR-048, FR-050–FR-054, FR-056, FR-057. One query (`GET /api/incidents`), server-side sort/page/search. Also the destination every cross-tab jump flashes and scrolls into view (FR-021). |
| `IncidentRow` | UI Primitive | Row rendering + click-to-open (FR-049). |
| `AgePill`, `PriorityPill`, `StatusPill`, `AutomationIcon` | UI Primitive | All carry a text label alongside colour (Principle X). `StatusPill` covers the full v2.0 status enum including `INVESTIGATING`/`MITIGATED` (data-model.md). |

## Cross-tab filtering (new — shared across Now/Performance/Knowledge)

| Component | Classification | FRs |
|---|---|---|
| `CrossTabFilterChip` | Shared Component | FR-022, FR-024, FR-026. Renders in a visually distinct style when its filter originated from another tab; its clear control clears the filter only, never navigates. |
| `CrossTabToast` | Shared Component | FR-023. Names the jump ("Jumped to Now — incidents that reached RAG match found."). |
| (behavior, not a component) `useCrossTabJump` | — | A `state/` hook, not listed as a component: switches tab via `useUrlState`, applies the filter, flashes `IncidentTable` (via a ref/id target), and fires the toast — the single call site every funnel/breakdown/tile click on Performance and Knowledge routes through, so FR-021's four-step sequence (switch, apply, flash, scroll) is never re-implemented per chart. |

## Detail drawer

| Component | Classification | FRs |
|---|---|---|
| `IncidentDetailDrawer` | Feature Component | FR-058, FR-059. Owns URL sync for `?incident=`, focus trap + restore (FR-113). One query (`GET /api/incidents/:id`) — isolation boundary for the whole drawer. |
| `IncidentHeaderActions` | Feature Component | FR-060, FR-061, FR-062. Disabled-with-reason state until the `PATCH` contract exists. |
| `ClassificationPanel` | Shared Component | FR-063. |
| `AgentRunTrace` | Feature Component | FR-064, FR-065. Lazy input/output fetch per run on expand. |
| `SimilarityMatchList` | Shared Component | FR-066. "Show all" triggers the uncapped fetch. |
| `ActionsAndExecutions` | Feature Component | FR-067, FR-068. Reuses `ApprovalCard`'s approve/reject behavior for any still-`PROPOSED` action found here. |
| `EventTimeline` | Feature Component | FR-069–FR-072. Server-side `agentOnly` toggle (contracts/incidents-endpoints.md). |
| `FeedbackImpactWidget` | Feature Component | FR-074–FR-079. One query (`GET /api/feedback/impact`); renders nothing when `suppressed` (FR-077) rather than a caveated version. Copy is static/model-attributed on decline (FR-078) — never server-driven, so there is no "blame" field to misuse. |
| `FeedbackForm` | Form Component | FR-073. React Hook Form. Rendered below `FeedbackImpactWidget`. |

## Performance tab

| Component | Classification | FRs |
|---|---|---|
| `KpiStrip` (Performance variant) | Feature Component | FR-080–FR-082. Same primitive as Now's, different tile set + data source. |
| `AutomationFunnel` | Feature Component | FR-083–FR-089. Hand-rolled (research.md §4 carried over from v1.0); every stage click routes through `useCrossTabJump`. |
| `ExecutionOutcomeDonut` | Feature Component | FR-090–FR-094. Recharts `Pie`. |
| `VolumeChart` | Feature Component | FR-095, FR-096. Recharts `ComposedChart` (stacked bars + line). |
| `BreakdownBars` | Feature Component | FR-097, FR-098. Three instances (priority/category/service); Recharts `BarChart`; every segment click routes through `useCrossTabJump`. |

## Knowledge tab (new)

| Component | Classification | FRs |
|---|---|---|
| `KpiStrip` (Knowledge variant) | Feature Component | FR-099. Same primitive, Knowledge tile set. |
| `CoverageGapsChart` | Feature Component | FR-100, FR-101. Hand-rolled horizontal bars, ascending sort, auto-captioned highest-leverage fix — the sort direction and caption are domain-computed (`domain/coverageGaps.ts`), not a Recharts option. |
| `DocumentsDrivingResolutions` | Shared Component | FR-102. Ranked list. |
| `DocumentationCandidates` | Feature Component | FR-103, FR-104. Reuses `IncidentRow`'s click-opens-drawer behavior; consumes `GET /api/incidents?candidate=true` (contracts/incidents-endpoints.md), not a separate Knowledge-specific row shape. |

## Cross-cutting shared components

| Component | Classification | Responsibility |
|---|---|---|
| `PanelBoundary` | Shared Component | Error boundary + the four-state switch (loading/empty-no-data/empty-filtered/error) wrapping every Feature Component above that owns a query (Principle VII, VIII). |
| `StaleBanner` | Shared Component | "Last updated Nm ago — reconnecting" (Principle VII stale rule). The alert strip's own stale/error state is the highest-stakes instance of this pattern (spec.md Edge Cases). |
| `RelativeTime` | UI Primitive | Relative-by-default, absolute+timezone on hover (X-5). |
| `ConfidenceBar` | UI Primitive | Bar + numeric value + low-confidence qualifier (AR-2). |
| `AccessibleChartTable` | Shared Component | A11Y-4. One per chart, toggled visible; fed the same domain-computed series as its chart sibling. Now also wired into `CoverageGapsChart` and `DocumentsDrivingResolutions`, not just Performance's charts. |

## Domain modules (no React — Principle III)

`domain/automationIcon.ts` (automation indicator), `domain/funnel.ts` (drop-set/annotation),
`domain/age.ts` (per-priority thresholds), `domain/kpi.ts` (delta direction, median null-guard),
`domain/filters.ts` (URL↔query translation, single-active-filter rule — now scoped across tabs,
not one page), `domain/feedbackAccuracy.ts` **(new)** — the agreement-rate computation (FR-075),
taking `DeveloperFeedback` rows + matching `AgentRun.output` and an injected clock (for the
"last one 3 days ago" relative display only; the accuracy figure itself needs no clock, per
Assumption 15's all-time/fixed-quarter windows), `domain/volumeBuckets.ts` (bucket granularity by
range), `domain/rejection.ts` (reject-form → feedback-request mapping), `domain/coverageGaps.ts`
**(new)** — ascending sort + highest-leverage-fix caption selection (FR-100/FR-101),
`domain/clock.ts` (injected `Clock` interface).

## Infrastructure

`api/client.ts` (typed `fetch` wrapper, one module per resource: `dashboard/alertStrip.ts`,
`dashboard/now.ts`, `dashboard/performance.ts`, `dashboard/breakdowns.ts`, `dashboard/knowledge.ts`,
`incidents.ts`, `approvals.ts`, `feedback.ts`, `feedbackImpact.ts`), `api/types.ts` (mirrors
data-model.md, including the new `KnowledgeEmbedding` entity), `api/fixtures/` (MSW seed data),
`state/useUrlState.ts` (now carries the active tab), `state/useCrossTabJump.ts`, `state/
OperatorContext.tsx`, `state/queryClient.ts`, `state/useFocusTrap.ts`.
