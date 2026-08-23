# Quickstart: AI Incident Response Orchestrator Dashboard

**Revised for PRD v2.0** (persistent alert strip + Now/Performance/Knowledge tabs).

## Prerequisites

Node.js and a package manager (Phase 1/Setup is complete — see `tasks.md`). No backend is required:
MSW serves every endpoint from `api/fixtures/seededDataset.ts` (research.md §7).

## Run

```bash
npm install
npm run dev        # Vite dev server; MSW registers in the browser automatically in dev mode
```

Open the printed local URL. The dashboard should be interactive against the seeded dataset with no
backend running.

## Verify the golden path manually

1. On load, the alert strip renders above the tab bar in its `hot` or `warm` state (the seeded
   dataset has at least one P1 and one pending approval), and the Now tab is selected by default.
2. The four Now tiles render before any chart on any tab (FR-116/P-2). Click "Unassigned" — the
   table filters, the URL gains a drill-down param, and the row count matches the tile (SC-005).
3. Switch to Performance, then Knowledge, then back to Now. Confirm the alert strip's two counts
   never changed across any of those switches (FR-011, SC-012), and that switching tabs produced no
   loading skeleton for content already loaded (FR-019).
4. Approve a `LOW`/`MEDIUM` card in the queue in one click; approve a `HIGH` card and confirm the
   second-click modal appears first. While that HIGH card is executing, reject a third card — confirm
   the HIGH card's elapsed timer keeps running uninterrupted through the rejection (FR-042, §11.19).
5. Watch the executing card resolve from "Executing…" to success/failure without a manual refresh
   (AR-7).
6. Reject a card without typing a reason — submission is refused. Type one — it succeeds.
7. Click an incident row. The drawer opens over a still-interactive dashboard, deep-links at
   `?incident=<internal-id>&tab=now`, and reload restores the same tab and open incident (FR-059,
   SC-010).
8. In the drawer, confirm any `FAILED` agent run is expanded by default and everything else is
   collapsed (FR-065). Scroll to the feedback section — confirm the feedback-impact widget shows a
   real accuracy percentage with a prior value, personal count, and team-quarter total (or is absent
   entirely if the seeded data is under the 10-correction threshold — check `seededDataset.ts`).
9. On Performance, click a funnel stage. Confirm: the dashboard switches to Now, the table flashes
   and scrolls into view, a distinctly-styled filter chip appears, a toast names the jump, and the
   row count matches the stage's displayed drop count (FR-021–FR-026, FR-085/FR-086, SC-005,
   SC-014). Clear the chip and confirm the dashboard stays on Now rather than jumping back to
   Performance (FR-024).
10. On Knowledge, confirm the coverage-gap chart is sorted worst-first (ascending known-rate, not by
    volume) with a caption naming the single highest-leverage fix (FR-100/FR-101). Click a
    documentation-candidate row and confirm the drawer opens exactly as it does from the incident
    table (FR-104).
11. Tab through the tab bar itself with arrow keys (FR-016), then through the approvals queue and
    the open drawer with the mouse untouched; confirm `Esc` closes the drawer and focus returns to
    the row that opened it (A11Y-3).

## Test commands

```bash
npm run test         # Vitest: domain/ unit tests + component tests (RTL)
npm run test:e2e     # Playwright: keyboard traversal, focus trap, tab navigation, cross-tab jump,
                      # sibling-card survival, full approve/reject flow
npm run typecheck    # tsc --noEmit, strict mode
npm run lint
```

## Where things live

See `component-inventory.md` for the component list and `data-model.md` / `contracts/*.md` for the
data every component consumes. `research.md` explains every "why this library" decision, including
§11–12 (tabs, alert-strip polling) added for v2.0.
