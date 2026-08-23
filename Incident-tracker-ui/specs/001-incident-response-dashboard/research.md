# Phase 0 Research: AI Incident Response Orchestrator Dashboard

Resolves every `NEEDS CLARIFICATION` left in `plan.md`'s Technical Context. The constitution's
Technology and Architecture Constraints fixes React + TypeScript strict + React Hook Form + React
Testing Library and forbids `any`; everything below is what sits *underneath* that line.

## 1. Build tooling

**Decision**: Vite.

**Rationale**: Native ESM dev server, near-instant HMR, first-class TypeScript, and a Vitest
counterpart that shares its config and transform pipeline — one toolchain instead of two. P-1 (FMP
< 2s) is easier to hold with esbuild-speed dev builds and Rollup's production tree-shaking.

**Alternatives considered**: Create React App — unmaintained, rejected outright. Next.js — brings
routing, SSR and a server runtime this feature doesn't use (it's one client-rendered route against
a JSON API); would violate the "don't add abstractions beyond what the task requires" guidance for
no benefit here.

## 2. URL state ("routing")

**Decision**: No router library. A single route (`/`) with a small custom hook
(`state/useUrlState.ts`) wrapping `URLSearchParams` + `history.replaceState`, exposing typed
getters/setters for time range, environment, service, search, the active drill-down, and
`?incident=<id>`.

**Rationale**: PRD §3 is one page; the "routes" the PRD describes (`/?incident=<id>`) are query-string
states of that one page, not distinct pages. Principle IX requires the URL to be the shareable
state, not that a router library own it. A dedicated hook keeps the read/write logic in one tested
module rather than scattered `useSearchParams` calls, and keeps the door open to add React Router
later without it being a rewrite (the hook's call sites don't change).

**Alternatives considered**: React Router (`useSearchParams`) — reasonable, but pulls in route
matching/nested-route machinery for a feature with exactly one route; deferred until a second page
exists.

## 3. Server-state cache

**Decision**: TanStack Query.

**Rationale**: This is the piece three constitution principles lean on directly. Principle VIII
(failure isolation) falls out naturally — one `useQuery` per panel means one panel's error state,
not a shared fetch that takes others down with it. Principle XI/X-2 polling (30s alert strip, 5min
Performance/Knowledge) is a `refetchInterval` option, not hand-rolled `setInterval` + cleanup.
Principle V's idempotent
approve maps to a `useMutation` keyed by action id, so a second click while one is in-flight is a
no-op by construction rather than a manually-tracked boolean.

**Alternatives considered**: Redux Toolkit Query — comparable feature set but pulls in a store for
data that has no client-owned state to hold (Storage is N/A per Technical Context); rejected as
more machinery than the problem needs. Hand-rolled `useEffect` fetching — explicitly what the
constitution's Technology Constraints section rules out ("not ad-hoc `useEffect` fetches").

## 4. Charting

**Decision**: Recharts for the volume trend (stacked bar + line overlay), the execution-outcome
donut, and the three breakdown bar charts. The automation funnel (B1) is a hand-rolled component,
not a charting-library funnel — its rows are click targets bound to domain-computed drop-sets
(FR-052) with an automatic drop annotation (FR-051), which is easier to own directly than to bend a
generic funnel chart into.

**Rationale**: Recharts renders SVG through React components (functional, composable — fits the
"functional components only" constraint) rather than a `<canvas>` blob, which is what makes A11Y-4's
"accessible table equivalent" tractable: every chart gets a sibling `<AccessibleChartTable>` fed the
same domain-computed series, toggled via a visible control, satisfying A11Y-4 without fighting the
chart's rendering internals.

**Alternatives considered**: Chart.js/`react-chartjs-2` — canvas-based, so the accessible-equivalent
requirement would always mean building a second parallel rendering anyway; Recharts gets that for
"free" via examining its React tree in tests. visx — lower-level primitives, faster iteration for a
funnel-only build but far more code to hand-write for standard bar/donut/stacked-bar-plus-line
charts than the time budget (PRD §12 build order) supports.

## 5. Test runner

**Decision**: Vitest, paired with React Testing Library (fixed by the constitution).

**Rationale**: Shares Vite's config and transform pipeline, so `domain/` unit tests, component tests,
and the dev server all resolve TypeScript and path aliases identically — no second bundler
configuration to keep in sync. Jest-compatible API, so nothing here fights RTL's own examples.

**Alternatives considered**: Jest — the obvious default, but requires a separate ts-jest/babel
transform pipeline that has to be kept consistent with Vite's; no material benefit here since RTL
is transport-agnostic.

## 6. End-to-end runner

**Decision**: Playwright.

**Rationale**: Principle XII's mandatory test areas include keyboard traversal of the approval queue
and drawer (A11Y-3), and Principle X requires focus restoration on close — both are real-browser
concerns that jsdom (what Vitest/RTL use) does not fully model. Playwright's accessibility-tree
snapshot and keyboard-event fidelity make those assertions direct rather than simulated.

**Alternatives considered**: Cypress — comparable coverage, weaker multi-tab/native-keyboard-event
fidelity for the specific focus-trap and tab-order assertions this feature needs most.

## 7. Mocking the backend — one mechanism, two constitution obligations

The constitution states two requirements that look separate but are the same problem:

- Technology Constraints: "a mock implementation of the same typed interface MUST be swappable for
  the real client, so the UI is buildable and demoable before the backend exists."
- Principle XII: "Tests run against a mocked HTTP boundary — never a live backend."

**Decision**: Mock Service Worker (MSW), backed by one fixtures module
(`api/fixtures/seeded-dataset.ts`) derived from the PRD's own numbers (§B1's 142/98/87/79/71/68
funnel, the service/category/priority breakdown counts in §B4, the card anatomy in §A2). MSW
intercepts `fetch` at the network layer in both the browser (dev-without-backend) and Vitest/Node
(tests), so `api/*.ts` always makes a real `fetch` call against the PRD §9 paths — there is no
separate "mock client" branch of application code to keep in sync with the real one. Turning off
the backend's absence later is deleting the MSW worker registration, not editing `api/*.ts`.

**Rationale**: satisfies both quoted requirements with one artifact instead of two, and means the
demo runs against the exact request/response shapes the contracts in this plan define — a
mismatch between "what the mock returns" and "what the real endpoint will return" is caught at
contract-writing time, not discovered later.

**Alternatives considered**: A hand-written second implementation of the `api/` interface
(`mockClient.ts` returning fixture objects directly, bypassing `fetch`) — this is what the
constitution's wording literally suggests, but it means every endpoint's logic exists twice (the
`fetch`-calling version and the fixture-returning version), and Principle XII explicitly wants the
HTTP boundary itself mocked, not the client swapped out. MSW satisfies the constitution's intent
more precisely than its literal phrasing.

## 8. Rendering untrusted/structured text safely (AR-3, Principle XIII)

**Decision**: `sql-formatter` (pure string → string, pretty-prints SQL text with no DOM access) for
`action_type = 'SQL'` parameters, plus a small hand-written regex tokenizer that renders highlighted
JSON/SQL as React `<span>` elements — never `dangerouslySetInnerHTML`. Both are dynamically
imported the first time a card's parameters section is expanded (P-4: JSONB is fetched and rendered
lazily on expand, never in the initial bundle or list response).

**Rationale**: Principle XIII forbids rendering external strings as HTML; a React-element tokenizer
gets syntax colour without ever parsing the content as markup. Deferred import keeps this off the
P-1 first-paint budget entirely — it's dead weight until a user expands something.

**Alternatives considered**: `react-syntax-highlighter` (Prism/Highlight.js wrapper) — heavier
dependency for the same "render as React elements" safety property a ~50-line tokenizer already
gets; rejected on bundle weight for a hackathon MVP, revisit if language coverage needs grow.

## 9. Focus trap (A11Y-3, drawer + HIGH-risk confirm modal)

**Decision**: A small hand-written `useFocusTrap` hook (cycles Tab/Shift+Tab within a container ref,
restores focus to the triggering element on close), used by both the detail drawer and the
HIGH-risk confirmation modal.

**Rationale**: Two call sites, well-understood behavior, and it needs to be exercised by both RTL
(unit-level tab-order assertions) and Playwright (real keyboard events) — owning it directly avoids
a dependency whose internals would otherwise need reverse-engineering for either test layer.

**Alternatives considered**: `focus-trap-react` — fine library, but two call sites don't justify a
dependency whose escape-hatch behaviors (iframes, portals) this feature doesn't need.

## 10. Client-only state that isn't server state or URL state

**Decision**: One `OperatorContext` (React Context + `localStorage`) for the self-declared operator
name (FR-119/FR-120/FR-121) and the low-confidence threshold default (Assumption 10). No global
state library.

**Rationale**: Everything that looks like "app state" is actually one of three things already
covered: server data (TanStack Query), shareable view state (the URL hook), or this one small
piece of per-browser identity. A general-purpose store (Redux, Zustand) would hold nothing else.

**Alternatives considered**: Zustand — reasonable size for this need, but a second state mechanism
alongside Context for exactly one piece of data isn't justified.

## 11. Tabs (added for PRD v2.0)

**Decision**: Hand-rolled, following the ARIA APG tabs pattern — a `TabBar` owning
`role="tablist"`/`role="tab"`/`aria-selected` and roving-tabindex arrow-key navigation (FR-016), and
three always-mounted `TabPanel`s whose visibility is toggled with the native `hidden` attribute, not
conditional rendering.

**Rationale**: Three tabs, one well-documented ARIA pattern, no nested routing — the same
"well-understood, few call sites, needs to be exercised by both RTL and Playwright" reasoning that
already justified hand-rolling `useFocusTrap` (§9) and the funnel (§4) rather than reaching for a
dependency. It also makes FR-019/FR-108/Assumption 16 (panels stay mounted; Performance and
Knowledge keep polling while not the visible tab) fall out of the architecture for free: nothing
unmounts on a tab switch, so nothing re-mounts, so TanStack Query never sees a mount-triggered
refetch to suppress — there is no special "don't refetch on tab switch" logic to write, because tab
switching was never a mount event in the first place. The native `hidden` attribute additionally
removes hidden panels from the accessibility tree and the tab order automatically, which a
`display: none` class alone does the same way but a conditional-render approach cannot give you for
free.

**Alternatives considered**: React Router with nested routes per tab — would need panels to
unmount/remount on navigation (the opposite of what TB-4 requires) unless deliberately fought with
`Outlet` caching workarounds; more machinery than three fixed, non-nested tabs need. A UI-kit tabs
component (Radix, Headless UI) — reasonable, but pulls in a dependency for a pattern this project
already has a hand-rolled example of (the focus-trap hook), and this project's few interactive
primitives are otherwise all hand-rolled by design.

## 12. Alert strip polling independent of the active tab

**Decision**: The `AlertStrip` component and its TanStack Query live in `DashboardHeader`, outside
any `TabPanel` — it is never inside tab content, so it is never affected by which tab is visible.
Its own `refetchInterval` (30s, FR-015) runs unconditionally from first mount, same as any other
always-mounted query.

**Rationale**: This is the direct consequence of decision #11 above, stated explicitly because
FR-015/FR-108/SC-013 make it a load-bearing requirement in its own right, not an incidental
side-effect worth leaving implicit.

## Resolved Technical Context

| Field | Resolution |
|---|---|
| Primary Dependencies | React, React Hook Form (fixed) + TanStack Query, Recharts, `sql-formatter`, MSW (dev), Vite. No tabs/routing library (§11) |
| Storage | `localStorage` for the operator name only (FR-121); no other client-owned persistence |
| Testing | React Testing Library (fixed) + Vitest (unit/component) + Playwright (e2e/keyboard/a11y) + MSW (HTTP mocking, both contexts) |
| Target Platform | Evergreen desktop browsers (latest two versions of Chrome, Edge, Firefox, Safari). No mobile layout — the PRD's fixed tab/strip layout and the prototype's ~1360px max-width design assume a desk-bound operator, and no responsive breakpoint is specified anywhere in the PRD. |
| Scale/Scope | Seeded hackathon dataset (PRD's own numbers: ~142 incidents/period, dozens of pending actions, 5-6 services, ~1,284 knowledge chunks) across the alert strip plus three tabs' worth of independently-loading panels, all mounted simultaneously (§11) |
