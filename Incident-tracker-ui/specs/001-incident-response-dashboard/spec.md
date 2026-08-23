# Feature Specification: AI Incident Response Orchestrator Dashboard

**Feature Branch**: `001-incident-response-dashboard`
**Created**: 2026-08-14
**Last revised**: 2026-08-16 (PRD v2.0 — tabbed IA + persistent alert strip)
**Status**: Draft
**Input**: User description: "review the @docs/ui_prd_incident_orchestrator_dashboard.md and @docs/incident_dashboard_prototype.html to create the spec" (v1.0), followed by "review the @docs/ui_prd_incident_orchestrator_dashboard (1).md and @docs/incident_dashboard_prototype (1).html for new updates on the final result" (v2.0)

## Revision note (v1.0 → v2.0)

The PRD's own changelog (§0 of the source document) restructures the information architecture: two
stacked bands become **three tabs** (Now / Performance / Knowledge) plus a **persistent alert
strip** that renders above the tab bar on every tab. This is not an incremental edit — every user
story, most functional requirements, the API surface, and the acceptance criteria changed. This
revision supersedes the v1.0 spec in place, under the same feature. Nothing feature-specific had
been implemented against v1.0 (only project scaffolding — Vite/TypeScript/ESLint/Vitest/
Playwright/MSW — which this revision does not touch), so no implementation work is discarded.

## Clarifications

### Session 2026-08-14 (v1.0 — still valid, untouched by the v2.0 IA change)

- Q: PRD §D1 requires four incident-mutation controls (assign, change priority, escalate, resolve) but PRD §9 defines no endpoint for them — how should this be resolved? → A: Treat it as a PRD §9 gap and close it — one documented incident-update operation covers all four controls, recorded as a dependency rather than invented ad hoc.
- Q: When a drill-down is already active and the user clicks a different tile, funnel stage, or breakdown segment, what happens? → A: One drill-down at a time — the new selection replaces the previous. Global filters, search and include-resolved always apply in addition, preserving exact reconciliation. **(Superseded in mechanism, not outcome, by the v2.0 session below: the "new selection replaces the previous" rule now applies across tabs, not just within one page.)**
- Q: How long should a card track a running execution before it stops implying imminent resolution? → A: 2 minutes, then switch to a "still running" state with elapsed time, a slower poll, and a manual re-check — never inferring failure from silence.
- Q: Which incident identifier should the deep link carry? → A: The internal identifier, matching PRD §7 and §9 as written. The external identifier stays a display value only, avoiding a second undefined lookup.

### Session 2026-08-16 (v2.0 — resolving PRD v2's own underspecified points)

- Q: The funnel/breakdown drill-down mechanism changed from a same-page filter to a cross-tab jump (switch to Now, apply filter, flash, distinct chip, toast). Does the *destination* of a funnel-stage click stay the drop-set (incidents that reached the preceding stage but not this one), as decided in the 2026-08-14 session, or does it change now that the PRD's own v2 prototype code filters by cohort (`stage >= n`, labeled "Reached: X") instead? → A: Keep the drop-set. The PRD v2 *prose* is unchanged from v1 ("filters to incidents that reached but did not pass that stage") and the constitution treats the prototype as a non-authoritative visual reference; the prototype's cohort-style demo code is drift in the wireframe's mock JS, not a requirements change.
- Q: FI-1 defines classifier accuracy as "agreement rate between `agent_runs.output` and any `developer_feedback` correction" but doesn't state the denominator. → A: All incidents with any `developer_feedback` row (of any `feedback_type`) in scope. The numerator is incidents whose feedback recorded no disagreement (`feedback_type='APPROVED'`, or a `CORRECTED` row whose correction happens to equal the original classification). Incidents with no feedback at all are excluded from both numerator and denominator — silence is not evidence of agreement.
- Q: Which time window governs the feedback-impact widget's three numbers (personal accuracy trend, personal correction count, team total)? → A: Personal accuracy and personal correction count are all-time running totals, independent of the dashboard's time-range control. The team total is always the current calendar quarter, also independent of the time-range control. Matches the mock's own copy ("last one 3 days ago", "this quarter") and avoids a 24h window making a motivational metric swing on almost no data.

## User Scenarios & Testing *(mandatory)*

Three people use this screen, each defaulting to their own tab, with one thing visible to all three
regardless of which tab they're on. The **on-call engineer** works **Now** under time pressure; the
**eng manager / SRE lead** reads **Performance** to judge automation trust; the **runbook owner /
knowledge maintainer** reads **Knowledge** to find where the AI has nothing to work with. Everyone
lands on Now by default. The active tab is carried in the URL (shareable), not remembered per user.

Above all three tabs, the **alert strip** shows P1-active and awaiting-approval counts at all
times — switching tabs never hides it, and it keeps polling even while a different tab is open.

### User Story 1 - Triage without ever losing sight of what's critical (Priority: P1)

An on-call engineer opens the dashboard and immediately sees, in the alert strip, whether anything
is on fire — before reading anything else. They land on the Now tab: four operational tiles (open,
escalated, unassigned, oldest-open), the incident table, and — reachable from the strip itself, not
buried behind a tab — the approvals queue. They scan the table, spot the aging incident, click it,
and read its full story in the drawer without losing the dashboard behind it. If they wander onto
Performance or Knowledge to check something else, the strip keeps telling them the truth about
what's critical the whole time.

**Why this priority**: This is the read-only spine plus the one component explicitly designed to
never regress when tabs were introduced. It proves the data model end to end and is the only story
that delivers value with nothing else built — an engineer can triage with just this.

**Independent Test**: Load the dashboard against a seeded dataset with a mix of open/resolved
incidents and at least one P1 and one pending approval. Verify the alert strip shows both counts
in its "hot" state; verify the four Now tiles report correct values; verify clicking any tile
filters the table; verify a row click opens the drawer over a still-interactive dashboard; verify
switching to Performance and back leaves the strip's counts unchanged and still accurate; verify
reloading a copied URL restores the same tab, filters, and open incident.

**Acceptance Scenarios**:

1. **Given** a seeded dataset with at least one active P1 and one pending approval, **When** the
   dashboard loads, **Then** the alert strip renders in its "hot" state showing both counts, above
   the tab bar, and the Now tab is selected by default.
2. **Given** the alert strip is in its "hot" or "warm" state, **When** the engineer clicks the P1
   count, **Then** the dashboard switches to Now (if not already there), filters the table to
   active P1 incidents, and the strip's own counts do not change.
3. **Given** a dataset with zero P1s and zero pending approvals, **When** the strip renders,
   **Then** it shows a calm resting message ("No critical incidents · no approvals pending") rather
   than disappearing or rendering empty.
4. **Given** the engineer is on the Performance or Knowledge tab, **When** two minutes pass and a
   new P1 arrives, **Then** the alert strip updates to reflect it without the engineer switching
   tabs or refreshing.
5. **Given** the four Now tiles are displayed, **When** the engineer clicks "Unassigned", **Then**
   the incident table filters to exactly those rows and the active filter is named on screen and
   reflected in the URL.
6. **Given** the incident table, **When** the engineer clicks any row, **Then** a right-side detail
   panel slides over the dashboard, the dashboard remains visible and interactive behind it, and no
   page navigation occurs.
7. **Given** the detail panel is open, **When** the engineer presses `Esc` or clicks outside it,
   **Then** it closes and keyboard focus returns to the row that opened it.
8. **Given** an incident whose agent trace contains a failed run, **When** the detail panel opens,
   **Then** that failed run is already expanded with its error message visible while successful runs
   stay collapsed.
9. **Given** a URL containing a tab and an incident identifier, **When** it is opened in a new
   browser session, **Then** the dashboard loads on that tab with that incident's detail panel
   already open.
10. **Given** an incident older than its priority threshold (30m for P1, 2h for P2, 8h for P3, 24h
    for P4), **When** the table renders, **Then** its age is visually flagged and carries a text
    label, not colour alone.
11. **Given** the Now tiles, **When** the engineer looks for a P1-active or awaiting-approval tile
    among them, **Then** neither exists — both live exclusively in the alert strip, never duplicated
    into a tile.

---

### User Story 2 - Approve or reject an AI-proposed action (Priority: P2)

A proposed remediation is waiting in the queue on the Now tab — reachable directly from the alert
strip's "awaiting approval" count from any tab. The engineer reads the card: priority, risk level,
the proposed action, its confidence, the parameters, and the evidence behind it. If it looks right
they approve it — a second confirmation for HIGH risk — and the card resolves in place from
"Executing…" to success or failure. If it looks wrong they reject it and must say why. If several
actions are in flight at once, approving or rejecting one never disturbs the others' live state.

**Why this priority**: The human-in-the-loop gate and the demo moment — the only part of the
product that changes production state, and the one place a queue re-render destroying a sibling
card's timer would be a real, previously-seen bug (PRD v2 §11 AC-19).

**Independent Test**: With multiple pending proposed actions, approve a HIGH-risk action through
its confirmation step while a second action is still executing, and confirm the second action's
timer is undisturbed; reject a third action without a reason and confirm the form refuses to submit;
double-click Approve and confirm exactly one execution is triggered; confirm the queue is reachable
and unchanged in position whichever tab it was navigated to from.

**Acceptance Scenarios**:

1. **Given** actions proposed and requiring approval, **When** the queue renders on the Now tab,
   **Then** one card appears per action sorted by incident priority, then risk level, then age —
   and actions not requiring approval never appear.
2. **Given** the alert strip shows an "awaiting approval" count from any tab, **When** the engineer
   clicks it, **Then** the dashboard switches to Now, scrolls to the queue, and flashes it — the
   queue itself never moved or required a separate tab.
3. **Given** a card for a HIGH-risk action, **When** the engineer clicks Approve, **Then** a
   confirmation step restates the action and requires a second explicit click before anything runs.
4. **Given** a card for a LOW or MEDIUM-risk action, **When** the engineer clicks Approve, **Then**
   the action is submitted in one click with no confirmation step.
5. **Given** an approval has been submitted, **When** the engineer clicks Approve again or
   double-clicks it, **Then** the control is already disabled and exactly one execution is triggered.
6. **Given** two actions are approved in quick succession and a third is rejected while the first two
   are still executing, **When** the queue re-renders after the rejection, **Then** both executing
   cards keep their live elapsed timers running without interruption or reset.
7. **Given** an approved action is running, **When** the engineer stays on the page, **Then** the
   card shows an executing state with an elapsed timer and resolves in place to success or to
   failure with the error message — with no manual refresh.
8. **Given** the engineer clicks Reject, **When** they submit without entering a reason, **Then**
   submission is refused and the reason field is flagged as required.
9. **Given** a rejection with a reason, **When** it is submitted, **Then** the action is recorded as
   rejected, the reason is captured as developer feedback, and an optional corrected category or
   priority is recorded when supplied.
10. **Given** a proposed action, **When** the engineer expands "Why this action", **Then** the
    similarity matches that drove it are listed with document type, title, score, and a link to the
    source.
11. **Given** an action whose confidence is below the low-confidence threshold, **When** the card
    renders, **Then** it is visibly qualified with a "review parameters" caption in addition to the
    numeric confidence.
12. **Given** an approve or reject request that fails, **When** the response arrives, **Then** the
    optimistic change is rolled back and the failure is surfaced without losing the engineer's input.
13. **Given** no actions are awaiting approval, **When** the queue renders, **Then** it states the
    positive outcome including how many actions ran automatically in the active period, and the
    alert strip's awaiting-approval count and the Now tab badge both read zero and the badge is
    hidden rather than showing "0".
14. **Given** no operator name has been recorded yet, **When** the engineer approves or rejects,
    **Then** they are asked for their name first and the action does not proceed until it is supplied.

---

### User Story 3 - See the automation trust argument, with drill-downs that explain themselves (Priority: P3)

An eng manager opens the Performance tab and reads the three automation tiles, the funnel from
incidents received down to validated-and-resolved, and the execution-outcome breakdown — with
rolled-back always counted apart from failed, because a silent rollback is worse than a loud one.
When they click a funnel stage or a breakdown bar, the dashboard doesn't just filter something
off-screen: it switches to Now, applies the filter, flashes the incident table into view, shows a
distinctly-styled filter chip, and tells them in a toast exactly what happened.

**Why this priority**: This is the trust argument, and the drill-down mechanism is the one thing
that got harder with tabs — a filter that changes an off-screen tab has to explain itself or it reads
as broken. Nobody is blocked on this story; Now's triage loop works without it.

**Independent Test**: Verify each funnel stage's count and drop count and each execution outcome
count independently; confirm rolled-back is never folded into success or failure; click a funnel
stage from Performance and confirm the dashboard switches to Now, the table's row count reconciles
exactly with the stage's displayed drop count, the table flashes, a distinctly-styled chip appears,
and a toast names what happened; confirm clearing that chip does not navigate back to Performance.

**Acceptance Scenarios**:

1. **Given** the Performance tab, **When** it renders, **Then** three tiles show automation rate,
   median time to resolve, and known-incident hit rate — with median (not average) as the headline
   value and average available in the tooltip.
2. **Given** the active time range and environment, **When** the funnel renders, **Then** each stage
   shows an absolute count and its percentage of the stage above.
3. **Given** the funnel is rendered, **When** stage-to-stage drops are compared, **Then** the largest
   drop is annotated automatically with the stage pair and the magnitude, naming the Knowledge tab
   as the likely next step.
4. **Given** the funnel is rendered, **When** the manager clicks a stage, **Then** the dashboard
   switches to the Now tab, the incident table filters to the incidents that reached the preceding
   stage but did not pass this one, the table is flashed and scrolled into view, a distinctly-styled
   filter chip appears, and a toast names the stage jumped from.
5. **Given** a stage that lost no incidents, **When** the manager clicks it, **Then** the same jump
   occurs and the table shows the filtered-empty state naming that stage, not a no-data state.
6. **Given** a cross-tab filter chip is showing on Now, **When** the manager clicks its clear
   control, **Then** the filter clears but the dashboard stays on Now — it does not navigate back to
   Performance.
7. **Given** executed actions of mixed status, **When** the outcome breakdown renders, **Then**
   rolled-back executions are reported as their own count, separate from both success and failure,
   everywhere they appear.
8. **Given** the outcome breakdown, **When** the manager toggles the by-type view, **Then** outcomes
   split by action type so an unreliable automation class is identifiable.
9. **Given** recent failed executions exist, **When** the outcome panel renders, **Then** the most
   recent failures are listed with action type, incident, a truncated error message, and a link that
   opens that incident's detail panel.
10. **Given** the automation rate is displayed, **When** the manager reads it, **Then** the
    fully-automated percentage and the human-assisted percentage appear as two adjacent numbers,
    never merged into one.

---

### User Story 4 - Find where the AI has nothing to work with, and see the effect of fixing it (Priority: P4)

A runbook owner opens the Knowledge tab and reads the coverage-gap chart — sorted worst-first, not
by volume, with a caption naming the single highest-leverage fix — plus which documents actually
earn their resolutions and which resolved incidents never got written up. Separately, an engineer
opens any incident's drawer and sees, above the feedback form, a widget showing that their
corrections are measurably improving the classifier — a real, derivable number, never framed as a
personal failure, and silent until there's enough data to mean anything.

**Why this priority**: This is where the funnel's own data says the work is — the largest
stage-to-stage drop is a content problem, not a model problem — and the feedback widget is the one
motivational pattern in this product, built because submitting feedback is the hardest behaviour to
get from engineers and it's what the entire learning loop depends on.

**Independent Test**: Verify the three Knowledge tiles, the coverage-gap ordering and caption, the
documents-driving-resolutions ranking, and the documentation-candidates list with recurrence counts;
verify the feedback-impact widget computes a real percentage from the seeded dataset's feedback
rows, is suppressed under the correction-count threshold, and never attributes a decline to the
user.

**Acceptance Scenarios**:

1. **Given** the Knowledge tab, **When** it renders, **Then** three tiles show total knowledge
   documents, services with at least one matched runbook, and undocumented resolutions.
2. **Given** the coverage-gap chart, **When** it renders, **Then** services are sorted by
   known-incident rate ascending (worst first), not by volume, and a caption names the single
   service whose improvement would move the funnel most.
3. **Given** the documents-driving-resolutions panel, **When** it renders, **Then** documents are
   ranked by how many resolutions they're linked to, surfacing by omission which documents are dead
   weight.
4. **Given** resolved incidents with no RAG match, **When** the documentation-candidates list
   renders, **Then** each row shows the incident, service, and why it qualifies, with a recurrence
   count shown whenever an incident pattern recurred more than once.
5. **Given** a documentation-candidate row, **When** the owner clicks it, **Then** the incident's
   detail drawer opens, matching the same interaction as every other row-click in this product.
6. **Given** an incident's drawer, **When** the feedback section renders, **Then** the feedback-impact
   widget shows a classification-accuracy percentage with its prior value, a personal correction
   count, and a team total for the current quarter.
7. **Given** fewer than 10 corrections exist team-wide, **When** the widget would render, **Then** it
   is suppressed entirely rather than showing a number computed from too little data.
8. **Given** accuracy has dropped since the prior period, **When** the widget renders, **Then** the
   copy attributes the change to the model or the period, never to the user's own feedback.
9. **Given** the feedback form, **When** the engineer submits a type and comments, **Then** it is
   recorded and listed above the form along with any existing feedback for that incident.

---

### User Story 5 - See volume trends and where incidents concentrate (Priority: P5)

The manager scrolls further down Performance to see whether volume is rising, whether resolution
time held, and which service is generating the most noise, via the priority, category, and service
breakdowns — clicking any segment jumps to Now exactly like a funnel stage does.

**Why this priority**: Every number here refines a question Stories 3 and 4 already answer with
higher leverage; the PRD's own build order places this last, after Knowledge and the feedback
widget, not before them.

**Independent Test**: Verify the volume buckets and the resolution-time overlay, the three
breakdowns, and that clicking any segment produces the same cross-tab jump behaviour as a funnel
stage (switch tab, flash, distinct chip, toast).

**Acceptance Scenarios**:

1. **Given** a 7-day or 30-day range, **When** the volume chart renders, **Then** incidents are
   stacked as known versus unknown in day buckets; **and** for a 24-hour range, in hour buckets.
2. **Given** the volume chart, **When** it renders, **Then** median resolution time is overlaid on a
   secondary axis so volume and resolution time are readable in one frame.
3. **Given** the breakdown charts, **When** they render, **Then** priority is shown P1 through P4,
   category is shown descending with the top six plus "Other", and the top five services each show
   their known-rate inline.
4. **Given** any breakdown segment, **When** the manager clicks it, **Then** the same cross-tab jump
   occurs as a funnel-stage click — switch to Now, filter, flash, distinct chip, toast.

---

### Edge Cases

- **No data at all versus nothing matching the filter** — an empty dataset explains how incidents
  arrive; an over-filtered view says so and offers a one-click clear. These must never render the
  same way.
- **The alert strip at zero versus the strip failing to load** — the calm resting state and a
  load error must look distinguishably different; a user must never mistake "quiet" for "broken",
  which is the entire reason the strip renders a resting message instead of disappearing.
- **The Now tab badge at zero** — hidden entirely, never rendered as "0" (a "0" badge trains people
  to stop reading badges).
- **Median over zero resolved incidents** — the tile shows an explicit no-value state, not `0m`.
- **Funnel with zero incidents received** — stage percentages have no denominator; the funnel reports
  the empty state rather than dividing by zero or showing `NaN`.
- **A funnel stage that lost nothing** — the cross-tab jump still occurs and yields the filtered-empty
  state for that stage, never a no-data state and never a silently unclickable row.
- **A cross-tab filter cleared, then the origin tab visited independently** — clearing the chip never
  navigates; visiting Performance again afterward shows no lingering filter state there, since the
  filter only ever applied to Now's table.
- **Two executions in flight when a third action is rejected** — the queue's re-render must not
  remount, reset, or otherwise disturb the two running cards' elapsed timers or subscriptions.
- **No operator name recorded yet** — any action needing attribution asks for one first rather than
  writing an empty or anonymous actor.
- **An action resolved by someone else while its card is on screen** — the approve or reject attempt
  is refused; the card reconciles to the true state and explains why, without appearing to have
  succeeded.
- **An execution that never reports completion** — the executing state does not spin forever; after 2
  minutes the card states that it is still running with elapsed time, slows its polling, and offers a
  manual re-check. Silence is never interpreted as failure.
- **Polling fails** — affected surfaces label how stale they are and that reconnection is being
  attempted; stale numbers are never presented as live. The alert strip's own poll failing is
  especially high-stakes, since its entire job is to be trustworthy from any tab.
- **An incident with no agent runs, no similarity matches, or no actions** — each detail section shows
  its own empty state independently; the panel still opens and the timeline still renders.
- **A deep link to an incident that does not exist or is outside the current filters** — the panel
  reports that the incident could not be loaded without breaking the dashboard behind it; an incident
  outside the active filters still opens.
- **A deep link naming a tab that doesn't exist** — falls back to Now rather than failing to load.
- **Missing or null confidence, unassigned incidents, unnamed services** — rendered as explicit
  unknown/unassigned states, with "Unassigned" treated as a warning rather than blank.
- **Very large parameter, log, or payload content** — expanding is scrollable and bounded; it never
  reflows the surrounding layout or blocks interaction.
- **A drill-down filter combined with a time-range change** — the current-state surfaces (the strip,
  Now's own tiles) keep showing current state; Performance and Knowledge re-evaluate against the new
  range; an active cross-tab filter on Now survives and is re-evaluated rather than silently dropped.
- **Rejecting an action whose incident has already been resolved** — permitted, with the resulting
  feedback still recorded, since the learning loop is the point.
- **The feedback-impact widget with fewer than 10 team-wide corrections** — suppressed entirely, not
  shown with a caveat or a low-confidence label — showing any number here is worse than showing none.
- **A resolved incident with feedback that neither confirms nor corrects anything usable** (e.g. a
  `CORRECTED` row with both `corrected_category` and `corrected_priority` null) — excluded from the
  accuracy denominator, since there is nothing to check agreement against.

## Requirements *(mandatory)*

### Functional Requirements

> Each FR cites the PRD requirement ID(s) it derives from (`AS-*`, `TB-*`, `XT-*`, `AR-*`, `IT-*`,
> `EO-*`, `TL-*`, `FI-*`, `K*`, `X-*`, `A11Y-*`, `P-*`) or the §11 acceptance criterion — Constitution
> Principle II. Every data-bound component in scope has its four states (loading, empty-no-data,
> empty-filtered, error) covered by a requirement — Constitution Principle VII.

**Global controls and shareable state**

- **FR-001**: Users MUST be able to set a time range of 24h, 7d, 30d, or All, defaulting to 7d.
  (PRD §4)
- **FR-002**: Users MUST be able to multi-select environment from Production, Staging and
  Development, defaulting to Production only. (PRD §4)
- **FR-003**: Users MUST be able to filter to a single service, defaulting to all services. (PRD §4)
- **FR-004**: The time range MUST apply to the Performance and Knowledge tabs only. The alert strip
  and the Now tab MUST always show current state regardless of the selected time range, and this
  MUST be surfaced in a tooltip on the time-range control, since it is surprising on first
  encounter. (PRD §4)
- **FR-005**: The active tab, time range, environment, service, free-text search, include-resolved
  toggle, active cross-tab filter, and the open detail panel MUST all persist in the URL so any view
  can be shared or bookmarked and restored by reload. (PRD §4, §3B/TB-2, §7, §11.7, §11.18)
- **FR-006**: The dashboard MUST show a live indicator stating how long ago data was updated, and
  MUST offer a manual refresh. (PRD §4)

**Alert strip**

- **FR-007**: The alert strip MUST render above the tab bar, inside the sticky header, on every tab,
  and MUST NOT be dismissible, collapsible, or scrollable away from. (AS-1, §11.11)
- **FR-008**: The strip MUST show exactly two counts — P1 active and awaiting approval — and no
  other metric. (AS-2)
- **FR-009**: The strip MUST render one of three states by severity: `hot` (≥1 active P1), `warm`
  (approvals pending, no P1), or `calm` (both zero). (AS-3)
- **FR-010**: At zero, the strip MUST render a positive resting message ("No critical incidents · no
  approvals pending") rather than disappearing or rendering blank. (AS-4, §11.13)
- **FR-011**: Both counts MUST be clickable. Clicking P1-active MUST switch to Now and filter to
  active P1 incidents. Clicking awaiting-approval MUST switch to Now and flash the approvals queue.
  Neither click MUST change the strip's own displayed counts. (AS-5, §11.2)
- **FR-012**: The strip MUST show a right-aligned secondary line: the age of the oldest pending
  approval when non-calm, or an automation count when calm. (AS-6)
- **FR-013**: The strip MUST use `role="status"` with `aria-live="polite"` — never `assertive`, which
  would interrupt on every poll. (AS-7)
- **FR-014**: The strip MUST ignore the time range, always reflecting current state. (AS-8)
- **FR-015**: The strip MUST continue polling at its normal cadence while any other tab is the
  active one — it MUST NOT pause, unmount, or degrade its refresh because Now is not currently
  visible. (X-2, §11.12)

**Tabs**

- **FR-016**: The dashboard MUST expose exactly three tabs — Now, Performance, Knowledge — using
  proper `tablist`/`tab`/`tabpanel` roles with `aria-selected`, with arrow-key navigation between
  them. (TB-1, A11Y-3)
- **FR-017**: The active tab MUST persist in the URL and be restored on load; an unrecognized tab
  value MUST fall back to Now rather than fail to load. (TB-2, §11.18)
- **FR-018**: The Now tab's badge MUST show the pending-approval count and MUST be hidden entirely
  at zero — never rendered as "0". (TB-3, §11.14)
- **FR-019**: Switching tabs MUST NOT trigger a refetch or a loading skeleton for panels that were
  already loaded; tab panels remain mounted and only their visibility toggles. (TB-4)
- **FR-020**: Time range, environment, service, search, and any active cross-tab filter MUST survive
  a tab switch in both directions. (TB-5, §11.17)

**Cross-tab filtering**

- **FR-021**: Clicking a funnel stage or a breakdown segment on Performance MUST switch to Now,
  apply the corresponding filter, flash the incident table with a brief focus ring, and scroll it
  into view. (XT-1, XT-2, §11.15)
- **FR-022**: A filter chip that originated from another tab MUST render in a visually distinct style
  from a same-tab filter chip, so its provenance is obvious. (XT-3, §11.15)
- **FR-023**: A cross-tab jump MUST emit a toast naming what happened (e.g. "Jumped to Now —
  incidents that reached RAG match found."). (XT-4, §11.15)
- **FR-024**: Clearing a cross-tab filter chip MUST clear the filter only — it MUST NOT navigate back
  to the tab the filter originated from. (XT-5, §11.16)
- **FR-025**: At most one filter — a KPI tile, a funnel stage's drop-set, or a breakdown segment —
  MAY be active at a time; selecting another MUST replace it, never accumulate. Global filters
  (time range, environment, service), search, and include-resolved always apply in addition.
  (PRD §3B, §B1/§B4 pattern carried into v2's tab model)
- **FR-026**: The active filter MUST be named on screen and MUST offer a one-click clear that returns
  the table to its default filter without disturbing global filters or navigating tabs. (PRD §A1
  pattern, FR-024)

**Now tab — operational tiles**

- **FR-027**: The Now tab MUST display four tiles: open incidents, escalated, unassigned, and oldest
  open — and MUST NOT include P1-active or awaiting-approval, which live exclusively in the alert
  strip. (N1, §11.11)
- **FR-028**: Each Now tile MUST be clickable and MUST filter the incident table to exactly the rows
  that produced its value, with the drill-down expressed in the URL. (N1)
- **FR-029**: The escalated tile MUST become visually urgent when above zero, and the unassigned
  tile MUST become visually cautionary when above zero — both with text labels, not colour alone.
  (N1, A11Y-1)
- **FR-030**: The Now tiles MUST ignore the time range, like the rest of the Now tab. (N1)

**Approvals queue**

- **FR-031**: The queue MUST show one card per proposed action requiring approval, sorted by incident
  priority, then risk level, then age, on the Now tab. (N2, AR-*)
- **FR-032**: Actions not requiring approval MUST NOT appear in the queue; they surface only in the
  Performance tab and the incident timeline. (AR-10)
- **FR-033**: Risk level MUST be rendered as an unmissable badge carrying a text label in every case.
  (AR-1, A11Y-1)
- **FR-034**: Confidence MUST be rendered as a bar together with its numeric value; below a
  configurable threshold (default 0.70) the card MUST be visibly qualified and state that parameters
  need review. (AR-2)
- **FR-035**: Action parameters MUST be collapsed by default and expandable, rendered monospaced and
  syntax-highlighted; a SQL action MUST render as formatted SQL rather than raw payload. (AR-3)
- **FR-036**: "Why this action" MUST expand to the similarity matches that drove the recommendation —
  document title, type, score, and a link to the source. (AR-4)
- **FR-037**: Approving a HIGH-risk action MUST require a confirmation step restating the action and
  a second explicit click; LOW and MEDIUM risk MUST approve in one click. (AR-5, §11.2)
- **FR-038**: Rejecting MUST require a free-text reason and MUST accept an optional corrected category
  and priority; submission without a reason MUST be refused. (AR-6, §11.3)
- **FR-039**: A rejection MUST record the action as rejected **and** record developer feedback of type
  rejected carrying the reason. (AR-6, §11.3)
- **FR-040**: On approval the card MUST enter an executing state with elapsed time and MUST resolve in
  place to success or to failure with its error message, without a manual refresh. (AR-7, §11.2)
- **FR-041**: If an execution has not reported completion within 2 minutes, the card MUST switch to a
  "still running" state showing elapsed time, MUST reduce its polling cadence, and MUST offer a manual
  re-check. It MUST NOT report a failure it has not observed. (AR-7)
- **FR-042**: When multiple actions are in flight, resolving or removing one card MUST NOT interrupt,
  reset, or remount any sibling card's executing state, elapsed timer, or in-flight poll. (§11.19)
- **FR-043**: Every approve and reject MUST record who acted and when, and MUST emit the corresponding
  incident event. (AR-8)
- **FR-044**: The Approve control MUST disable immediately on activation so that repeated or
  double-clicks cannot trigger more than one execution. (X-4, §11.9)
- **FR-045**: Approve and reject MUST apply optimistically and MUST roll back with a clear error if
  the write fails. (X-1)
- **FR-046**: The queue's empty state MUST be phrased as a positive outcome and MUST include how many
  actions executed automatically in the active period. (AR-9)
- **FR-047**: The approvals queue MUST remain reachable and in place regardless of which tab a user
  navigates from — it is never itself placed behind a tab. (§13 rejected-patterns: "approval queue
  behind its own tab")

**Incident table**

- **FR-048**: The table MUST default to unresolved incidents, sorted by priority then newest first,
  showing priority, status, title, service, environment, category, known-incident indicator with the
  best match score, AI confidence, age, assignee, and an automation indicator. (N3)
- **FR-049**: Clicking a row MUST open the detail panel over the dashboard and MUST NOT navigate away
  from it. (IT-1, §11.6)
- **FR-050**: Users MUST be able to sort by priority, age and confidence from the column headers.
  (IT-2)
- **FR-051**: Users MUST be able to search free-text across incident title, description and external
  identifier. (IT-3)
- **FR-052**: Users MUST be able to toggle "include resolved" to extend the list to all statuses
  within the active time range. (IT-4)
- **FR-053**: The list MUST paginate at 25 rows, with paging applied at the data source rather than by
  filtering a fully-loaded client set. (IT-5, P-3)
- **FR-054**: Each row MUST carry a source indicator (email, Slack, PagerDuty, API or manual) in the
  title cell. (IT-6)
- **FR-055**: Age MUST be flagged once it passes its per-priority threshold — 30 minutes for P1, 2
  hours for P2, 8 hours for P3, 24 hours for P4. (N3)
- **FR-056**: Escalated status MUST be visually distinct from open, and non-production environments
  MUST be de-emphasised — both while retaining text labels. (N3, A11Y-1)
- **FR-057**: The table MUST accept a funnel-stage drill-down parameter for cross-tab filtering,
  distinct from same-tab filters, per FR-021–FR-026. (PRD §9 `stage` param)

**Incident detail drawer**

- **FR-058**: The panel MUST open as a right-side slide-over occupying roughly 55% of the viewport,
  leave the dashboard visible and interactive behind a scrim, and close on `Esc` or click-outside.
  (PRD §7)
- **FR-059**: The panel MUST be deep-linkable by the incident's **internal** identifier. The external
  identifier is a display value only and MUST NOT be used for addressing. (PRD §7, §11.7)
- **FR-060**: The panel header MUST show external identifier, title, status, priority, service,
  environment, assignee, created and resolved timestamps, and source. (PRD §D1)
- **FR-061**: The panel MUST offer assign-to-me, change-priority, escalate and mark-resolved actions.
  All four MUST persist through a single incident-update operation and MUST record the acting
  operator. (PRD §D1)
- **FR-062**: While that incident-update operation is unavailable, the four controls MUST be visibly
  disabled with the reason stated — never hidden, and never appearing to succeed. (PRD §D1)
- **FR-063**: The panel MUST show the AI's category, priority and confidence, and where a human
  correction exists MUST show "AI said X → human corrected to Y" side by side. (PRD §D2)
- **FR-064**: The panel MUST list agent runs in start order with agent name and version, status,
  duration, confidence, and collapsible input and output. (PRD §D3)
- **FR-065**: Failed agent runs MUST be expanded by default with the error visible; all other runs
  MUST be collapsed. (PRD §D3, §11.6)
- **FR-066**: The panel MUST list similarity matches descending by score with document-type badge,
  title, score bar, summary snippet and external source link, capped at five with a show-all control.
  (PRD §D4)
- **FR-067**: The panel MUST list recommended actions with their executions nested underneath, showing
  type, description, risk, confidence, status, approver and timestamp, and — for executed actions —
  duration with collapsible response payload and execution logs. (PRD §D5)
- **FR-068**: Pending actions inside the panel MUST offer the same approve and reject behaviour as the
  queue, including the HIGH-risk confirmation and the required rejection reason. (PRD §D5)
- **FR-069**: The panel MUST show a chronological event timeline with an icon per event type, a
  human-readable description, relative and absolute timestamps, the actor, and expandable per-event
  payload. (PRD §D6)
- **FR-070**: The timeline MUST offer an "agent events only" filter. (TL-1)
- **FR-071**: Failure events — validation failed, action rejected, escalated — MUST be visually
  flagged with a text label. (TL-2, A11Y-1)
- **FR-072**: Each timeline event MUST show cumulative elapsed time since the incident was created.
  (TL-3)

**Feedback impact and form**

- **FR-073**: The panel MUST offer a feedback form at all times — type, comments, and optional
  corrected category, priority and resolution — and MUST list existing feedback above it. (PRD §D7)
- **FR-074**: Above the feedback form, the panel MUST show a feedback-impact widget with a
  classification-accuracy percentage, its prior value, a personal correction count, and a team total
  for the current quarter. (FI-1, FI-2)
- **FR-075**: The accuracy percentage MUST be computed as: of all incidents carrying any
  `developer_feedback` row, the share whose feedback recorded no disagreement (`APPROVED`, or a
  `CORRECTED` row whose correction equals the original classification). Incidents with no feedback
  are excluded from both numerator and denominator. (FI-1)
- **FR-076**: Personal accuracy and personal correction count MUST be all-time totals, independent of
  the dashboard's time-range control. The team total MUST always reflect the current calendar
  quarter, also independent of the time-range control. (FI-1, FI-2)
- **FR-077**: The widget MUST be suppressed entirely — not shown with a caveat — when team-wide
  corrections number fewer than 10. (FI-4, §11.20)
- **FR-078**: The widget MUST NEVER frame an accuracy decline as the user's failure; any decline MUST
  be attributed to the model or the period. (FI-3, §11.20)
- **FR-079**: The widget MUST show the team total alongside the personal count, and MUST NOT rank,
  score, badge, or otherwise gamify individual users against each other. (FI-2, FI-5)

**Performance tab — automation tiles**

- **FR-080**: The Performance tab MUST display three tiles: automation rate, median time to resolve,
  and known-incident hit rate. (N1b/P1)
- **FR-081**: Resolution time MUST be reported as the **median**; the average MAY be exposed in the
  tile's tooltip and MUST be labelled as the average. (N1b/P1)
- **FR-082**: Clicking any Performance tile MUST follow the cross-tab jump rules (FR-021–FR-026).
  (N1b/P1)

**Performance tab — funnel and outcomes**

- **FR-083**: The funnel MUST show incidents received, classified, RAG-matched, action-recommended,
  approved-or-auto-run, executed-successfully and validated-and-resolved, each with an absolute count
  and its percentage of the stage above. (P2)
- **FR-084**: The funnel MUST annotate the largest stage-to-stage drop automatically, naming the stage
  pair, the magnitude, and pointing to the Knowledge tab as the likely next step. (P2)
- **FR-085**: Clicking a funnel stage MUST trigger the cross-tab jump to that stage's **drop-set** —
  the incidents that reached the preceding stage but did not pass this one. (P2, §11.4)
- **FR-086**: Each stage MUST display its drop count alongside its own count, so that the filtered row
  count reconciles exactly with a number visible on the funnel. (P2, §11.4)
- **FR-087**: A stage that lost no incidents MUST remain clickable and MUST produce the cross-tab jump
  with the filtered-empty state naming that stage — distinguishable from having no data at all. (P2)
- **FR-088**: The first stage (incidents received) has no preceding stage and therefore no drop-set;
  clicking it MUST jump to all incidents in the active range. (P2)
- **FR-089**: Automation rate MUST be computed as resolved incidents that had a successful execution
  and never required human approval, and MUST be presented as two adjacent numbers — fully automated
  and human-assisted. (§6.1)
- **FR-090**: Execution outcomes MUST be shown as a distribution over success, failed, rolled-back and
  running, with the success rate as the centre label. (P3)
- **FR-091**: Rolled-back executions MUST be counted and displayed separately from both success and
  failure everywhere they appear. (EO-1, §11.5)
- **FR-092**: The system MUST list the most recent failed executions with action type, incident,
  truncated error message and a link that opens that incident's detail panel. (EO-2)
- **FR-093**: Users MUST be able to toggle an outcome breakdown by action type — SQL, Lambda, API,
  GitHub PR, Kubernetes. (EO-3)
- **FR-094**: Median execution duration MUST be shown as a caption on the outcome panel. (EO-4)

**Performance tab — volume and breakdowns**

- **FR-095**: The volume chart MUST stack known versus unknown incidents in day buckets for 7d and
  30d ranges and hour buckets for 24h. (P4)
- **FR-096**: The volume chart MUST overlay median resolution time on a secondary axis. (P4)
- **FR-097**: The system MUST show breakdowns by priority (P1→P4), by category (descending, top six
  plus "Other"), and by service (top five, each with its known-rate inline). (P5)
- **FR-098**: Every breakdown segment MUST follow the cross-tab jump rules (FR-021–FR-026). (P5)

**Knowledge tab**

- **FR-099**: The Knowledge tab MUST display three tiles: total knowledge documents indexed, services
  with at least one matched runbook document, and undocumented resolutions. (K1)
- **FR-100**: The coverage-gap chart MUST sort services by known-incident rate **ascending** (worst
  first), never by volume. (K2)
- **FR-101**: The coverage-gap chart MUST caption the single highest-leverage fix by name, not leave
  the inference to the reader. (K2)
- **FR-102**: The documents-driving-resolutions panel MUST rank documents by their linked resolution
  count. (K3)
- **FR-103**: The documentation-candidates list MUST show resolved incidents with no RAG match, each
  with incident, title, service, and why it qualifies, and MUST show a recurrence count whenever it
  exceeds one. (K4)
- **FR-104**: Clicking a documentation-candidate row MUST open that incident's detail panel, matching
  every other row-click in this product. (K4, FR-049)

**States, behaviour, accessibility, performance**

- **FR-105**: Every data-bound component MUST implement four distinct states — loading as a skeleton
  matching the final layout with no layout shift, empty-no-data explaining how data arrives,
  empty-filtered distinguishable from no-data with a one-click clear, and an inline retryable error.
  (PRD §8, §11.8)
- **FR-106**: A component's failure MUST NOT take down the dashboard; each panel fails and retries
  independently. (PRD §8)
- **FR-107**: When polling fails the affected surface MUST state how stale it is and that reconnection
  is in progress; stale values MUST NOT be presented as live. (PRD §8)
- **FR-108**: The alert strip MUST refresh every 30 seconds regardless of the active tab; Performance
  and Knowledge refresh on filter change and every 5 minutes. (X-2)
- **FR-109**: Refreshed values MUST NOT cause layout jump; value transitions are animated in place.
  (X-3)
- **FR-110**: Timestamps MUST display relative by default and absolute with timezone on hover. (X-5)
- **FR-111**: Colour MUST never be the sole carrier of meaning — every priority, risk, status and
  outcome indicator MUST carry a text label. (A11Y-1)
- **FR-112**: All indicators, text and chart series MUST meet WCAG AA contrast. (A11Y-2)
- **FR-113**: The tab bar, approval queue and detail panel MUST be fully keyboard operable — arrow
  keys between tabs, tab through cards, `Enter` to open detail, `Esc` to close — with focus trapped
  in the panel while open and restored on close. (A11Y-3, §11.10)
- **FR-114**: Every chart MUST offer an accessible tabular equivalent. (A11Y-4)
- **FR-115**: First meaningful paint MUST be under 2 seconds on the seeded dataset. (P-1)
- **FR-116**: Now-tab tiles MUST render before any chart; components load progressively and
  independently. (P-2)
- **FR-117**: Each aggregate MUST be served by a single request, with no per-row follow-up requests
  for the incident list. (P-3)
- **FR-118**: Large payloads — action parameters, agent input and output, execution logs and response
  payloads — MUST be fetched only when expanded and MUST NEVER be included in list responses. (P-4)
- **FR-119**: Approving, rejecting, assigning, escalating, resolving and submitting feedback MUST
  record the acting operator's identity. The operator supplies their own name once; it persists across
  reloads on that browser and accompanies every subsequent attributed action. (AR-8, PRD §D1, §D7)
- **FR-120**: When no operator name has been supplied yet, the first action requiring attribution MUST
  prompt for one, and MUST NOT complete until it is given. (AR-8)
- **FR-121**: The operator MUST be able to see and change the name currently being recorded. (AR-8)

### Out of Scope (v1/v2)

These are explicit non-goals (PRD §1) and MUST NOT be implemented by this feature:

- Creating or editing incidents from the dashboard — incidents arrive from email, monitoring and API.
- Authoring or editing knowledge base documents and runbooks — the Knowledge tab *identifies* gaps,
  it does not fill them.
- User management, role-based access control, on-call rotations, and SLA configuration.
- Historical report export.
- Role switching between personas or role-based views — explicitly rejected in PRD §13: needs RBAC
  this product doesn't have, and would hide operational state from whoever is most able to act on it.

**Also explicitly rejected (PRD §13) and MUST NOT be implemented:**

- The approval queue behind its own tab, or any navigation structure with no persistent strip —
  both were considered and rejected as regressions that hide work blocking resolution.
- The detail drawer as a full page or its own tab — loses list context.
- Any leaderboard, streak, badge, point/XP system, or ranking tied to incident closure speed,
  approval count, or P1 handling. Every rejected pattern in PRD §13 measures something that is also
  gameable, and this product does not introduce that failure mode. The only two motivational
  mechanisms in scope — the clearable queue's positive empty state (FR-046) and the feedback-impact
  widget (FR-074–FR-079) — reward real, database-verifiable outcomes and never rank people against
  each other.

### Key Entities

- **Incident**: A problem arriving from email, Slack, PagerDuty, API or manual entry. Carries external
  identifier, title, description, priority, status, environment, category, service, assignee, AI
  confidence, known-incident flag, and created/resolved timestamps.
- **Service**: The system an incident belongs to; supplies the name shown in the list and the service
  breakdown/coverage-gap charts.
- **Recommended Action**: A remediation the AI proposes for an incident — type, description, risk
  level, confidence, parameters, whether approval is required, status, and approver with timestamp.
- **Executed Action**: The record of a recommended action actually running — status (success, failed,
  rolled back, running), start and finish times, error message, response payload, execution logs.
- **Agent Run**: One agent's contribution to handling an incident — agent name and version, status,
  timing, confidence, input, output, error message.
- **Similarity Match**: A link from an incident to a knowledge document (past incident, runbook,
  postmortem, issue, documentation) with a relevance score, summary snippet and source link.
- **Knowledge Document**: An indexed document the RAG layer can match against — type, title, summary,
  source, and (new in v2.0) a count of indexed chunks/embeddings feeding the Knowledge tab's document
  tile.
- **Incident Event**: A timestamped entry in an incident's history — event type, description, actor,
  payload.
- **Developer Feedback**: A human judgement on an incident or action — feedback type, comments, and
  optional corrected category, priority or resolution. Also the sole input to the feedback-impact
  widget's accuracy computation (FR-075).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An on-call engineer clears a full approval queue — reading the evidence and deciding on
  each pending action — in under 60 seconds, from any tab, without first having to find the queue.
- **SC-002**: An engineer can explain any incident's handling (what the AI classified it as, what it
  matched, what ran, and what happened) without leaving the dashboard or querying a database.
- **SC-003**: The dashboard becomes useful within 2 seconds of opening on the seeded dataset, with the
  alert strip and Now's tiles readable before any chart has drawn.
- **SC-004**: An eng manager can state the period's automation rate, median time to resolve, and the
  noisiest service without asking anyone.
- **SC-005**: Every displayed aggregate reconciles exactly with the incidents behind it when drilled
  into — a tile value, a breakdown segment, and a funnel stage's drop count each return the row set
  they claim, with zero discrepancy, regardless of which tab the click originated from.
- **SC-006**: Approving the same action twice — by double-click or repeat activation — executes it
  exactly once, in 100% of attempts.
- **SC-007**: 100% of rejections capture a reason; none can be submitted without one.
- **SC-008**: Rolled-back executions are reported separately from successes and failures in 100% of
  the places execution outcomes appear.
- **SC-009**: The entire approval and inspection flow, including tab navigation, is completable using
  only a keyboard.
- **SC-010**: A URL copied from one browser reproduces the same tab, filters, drill-down and open
  incident in another.
- **SC-011**: Any single failing data source degrades only its own panel; the rest of the dashboard
  stays usable.
- **SC-012**: The alert strip's counts are identical whichever tab is active, 100% of the time — a
  tab switch never changes what the strip reports.
- **SC-013**: The strip continues to update while any other tab is active — seeding a new P1 while on
  Performance updates the strip within one polling interval, with no tab switch or manual refresh.
- **SC-014**: A cross-tab drill-down is self-explanatory without documentation — a first-time user
  who clicks a funnel stage can state, from the toast and the flash alone, what just happened and why
  they're looking at a different tab.
- **SC-015**: The feedback-impact widget never appears below the 10-correction threshold and never
  attributes a decline to the viewing user, in 100% of renders.

## Assumptions

1. **Backend availability** — the data services described in PRD §9 may not be running while this is
   built. The dashboard is therefore built against a fixed data contract, and a seeded stand-in
   dataset substitutes for live data so that every scenario above remains demonstrable and testable.
   No data shapes beyond those PRD §9 describes are introduced.
2. **Delta baseline** — range-scoped tiles (automation rate, median resolve, known-incident hit rate)
   compare against the immediately preceding window of equal length. Current-state tiles (the alert
   strip's two counts; Now's four tiles) compare against their value at the start of the active
   window, since they are fixed as current-state regardless of range.
3. **Execution polling cadence** — while an execution is running its status is polled substantially
   faster than the alert strip's 30-second cadence (target ~2 seconds), because approval cards must
   resolve in place. That fast cadence is bounded at 2 minutes, after which FR-041 takes over. The
   exact interval within that bound is a plan-level decision.
4. **"All" time range** — the volume chart uses day buckets, extending the 7d/30d rule; the PRD only
   specifies buckets for 24h/7d/30d.
5. **Validated-and-resolved funnel stage** — no validation record exists in the schema, so this stage
   cannot be computed. Per Constitution XIV it is **not** inferred from payload contents: the stage
   renders as explicitly unavailable, naming the missing upstream record, until that record exists.
6. **Rejection reason storage** — there is no dedicated rejection-reason field yet, so the reason is
   carried on the developer-feedback record. FR-038 and FR-039 are satisfied either way; only the
   storage location changes if the field is added.
7. **Agent run duration** — where a measured latency is unavailable, duration is derived from start
   and finish timestamps (the schema permits either).
8. **The four component states and accessibility obligations are requirements on every story**
   (Constitution VII and X), not a deferred polish pass, even though PRD §12's final build phase is
   titled "polish" — that phase is about breakdowns/volume (User Story 5) and hardening passes, not
   about which stories get accessible or stateful treatment.
9. **Timezone** — relative timestamps are the default; absolute values render in the viewer's local
   timezone with the zone named, per X-5.
10. **Low-confidence threshold** defaults to 0.70 and is configurable without a code change, per AR-2.
11. **All personas share one unauthenticated view** — no role switching, no per-role gating, since
    RBAC is an explicit non-goal and role-based views are explicitly rejected (PRD §13). Any control
    visibility is presentational only; the server remains the authority on whether an action is
    permitted (Constitution XIII).
12. **Operator identity is self-declared and unverified** (resolves FR-119) — the operator types their
    own name, which persists locally and is attached to attributed actions. This is an attribution
    convenience for the demo, not authentication: it is trivially spoofable, and no permission decision
    may depend on it.
13. **Funnel and breakdown clicks select the drop-set/segment, delivered via a cross-tab jump**
    (resolves FR-085, and the 2026-08-16 clarification session) — the underlying "what gets selected"
    decision from v1.0 (the drop-set, "show me the ones we lost here") is unchanged by v2.0; only the
    delivery mechanism changed, from a same-page filter to switch-tab-and-flash. The PRD v2 prototype's
    own demo code drifts toward cohort semantics (`stage >= n`); this is treated as wireframe drift,
    not a requirements change, consistent with the constitution's treatment of the prototype as a
    non-authoritative visual reference.
14. **Feedback-impact accuracy denominator** (resolves FR-075) — only incidents carrying a
    `developer_feedback` row count toward the metric, in either direction. This keeps the metric's
    claim honest ("of the times a human actually looked, how often was the AI right") rather than
    diluting it with incidents nobody reviewed.
15. **Feedback-impact time windows** (resolves FR-076) — personal figures are all-time; the team
    total is fixed to the current calendar quarter. Neither follows the dashboard's time-range
    control. This matches the widget's own mock copy and avoids a short window making a trust-building
    metric look erratic on sparse data.
16. **Panels-stay-mounted (TB-4) implies Performance and Knowledge continue their own polling/refetch
    cadence while not the visible tab** — "no refetch on tab switch" means switching *to* a tab
    doesn't force a fresh fetch of already-current data, not that background refresh stops while a
    tab is merely not visible. This is consistent with the alert strip's own explicit "keeps polling
    regardless of active tab" requirement (FR-015) and avoids every tab going stale the moment it's
    not the one in view.
17. **`knowledge_embeddings` is a new, previously-undocumented table** referenced by PRD v2's K1 tile
    query (`COUNT(*) FROM knowledge_embeddings`). It is treated as a given per Constitution I (not
    invented, not renamed) pending reconciliation against `ai_incident_response_database_schema.md`.

## Dependencies

- `docs/ui_prd_incident_orchestrator_dashboard (1).md` (v2.0) — the authoritative product spec this
  feature implements, superseding v1.0. All requirement IDs cited above are defined there.
- `ai_incident_response_database_schema.md` — **not present in this repository**. It owns every entity
  and field name used in Key Entities, including the new `knowledge_embeddings` table v2.0
  introduces. Names are treated as given; adjacent ones are not invented (Constitution I).
- The orchestrator backend exposing the v2.0 API surface — see Assumption 1 for how absence is
  handled.
- **An incident-update operation, which the PRD does not currently define** — required by FR-061 for
  assignee, priority, escalation and resolution. This is a gap in the PRD's API surface of the same
  kind §10 records for the schema, and closing it is a prerequisite for those four controls being
  enabled (FR-062 governs behaviour until then). No other write beyond the documented API surface is
  introduced.
- `docs/incident_dashboard_prototype (1).html` (v2.0) — visual reference for layout, states and
  interaction only, superseding the v1.0 prototype. It is a dependency-free wireframe with mock data
  and is not extended as application code. Where its demo code conflicts with the PRD's own prose
  (see Assumption 13), the PRD prose governs.
