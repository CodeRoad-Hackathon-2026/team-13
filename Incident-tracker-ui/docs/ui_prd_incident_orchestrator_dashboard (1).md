# UI PRD — AI Incident Response Orchestrator Dashboard

**Version:** 2.0
**Date:** 2026-08-15
**Owner:** Fran Collado
**Depends on:** `ai_incident_response_database_schema.md`
**Scope:** Tabbed dashboard with a persistent alert strip (MVP / hackathon)

### Changelog — v1.0 → v2.0

| Change | Reason |
|---|---|
| Two stacked bands → **three tabs** (Now / Performance / Knowledge) | Two audiences with different jobs were competing for one scroll. Tabs give each a focused screen. |
| Added a **persistent alert strip** above the tab bar | Tabs hide state. The strip is the mitigation: P1 count and pending approvals can never be hidden by a tab change. |
| KPI strip **split 4 / 3 / 3** across tabs | The original 6 tiles mixed operational and performance metrics. Keeping them together would have reintroduced the exact problem tabs were meant to solve. |
| Cross-tab filtering now **switches tab + flashes the target** | Clicking a funnel stage used to filter a table directly below it. Across tabs that same click has to explain itself or it reads as a teleport. |
| Added **Knowledge** tab | Runbook-gap work has a different owner and cadence than incident response. It was polluting the performance view. |
| Added **feedback-impact widget** to the drawer | The hardest behaviour to get from engineers is submitting feedback. Showing its effect on classifier accuracy is the one motivational pattern worth building here. |
| Added §13 — **rejected patterns** | Records what was considered and declined, so the debate isn't re-litigated every sprint. |

---

## 1. Summary

A dashboard that answers two questions, each with its own tab, without ever letting the first one go unnoticed:

1. **"What needs a human right now?"** — live incident queue and pending AI action approvals. *(Now tab, default)*
2. **"Is the AI actually working?"** — automation rate, execution success, known-incident hit rate. *(Performance tab)*

Plus a third that fell out of the funnel data: **"Where does the AI have nothing to work with?"** *(Knowledge tab)*

The dashboard is the primary demo surface for the orchestrator. It must make the AI's reasoning visible, not hidden, and it must let a human approve or reject a proposed action without leaving the page.

### Non-goals (v1)

- Incident creation/editing from the UI (incidents arrive via email/monitoring/API).
- Knowledge base authoring or runbook editing — the Knowledge tab *identifies* gaps, it does not fill them.
- User management, RBAC, on-call rotations, SLA config.
- Historical report export.

---

## 2. Users

| Persona | Job on this screen | Default tab | Success looks like |
|---|---|---|---|
| **On-call engineer** (primary, operational) | Triage the open queue, approve/reject AI-proposed actions, inspect what the AI did | Now | Clears the approval queue in under 60s; never has to open the DB to understand an incident |
| **Eng manager / SRE lead** (primary, analytical) | Judge whether automation is trustworthy and where incidents concentrate | Performance | Can state this week's automation rate, MTTR, and top failing service without asking anyone |
| **Runbook owner / knowledge maintainer** (secondary) | Find which services the RAG layer can't help with | Knowledge | Leaves with a prioritised list of runbooks to write |

Everyone lands on **Now**. The tab is remembered in the URL, not per-user, in v1.

---

## 3. Information architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ HEADER: title · time range · env · service · live indicator        │
├────────────────────────────────────────────────────────────────────┤
│ ⚠ ALERT STRIP — 2 P1 active · 3 awaiting approval                  │
│   never hidden · renders on every tab · calm state when zero       │
├────────────────────────────────────────────────────────────────────┤
│ [ Now ③ ]  [ Performance ]  [ Knowledge ]                          │
├────────────────────────────────────────────────────────────────────┤
│ TAB: NOW  (default — always current, ignores time range)           │
│  N1. KPI tiles ×4: open · escalated · unassigned · oldest open     │
│  N2. Pending approvals queue  ← never moves behind a tab            │
│  N3. Incidents table (filterable, searchable)                      │
├────────────────────────────────────────────────────────────────────┤
│ TAB: PERFORMANCE  (respects time range)                            │
│  P1. KPI tiles ×3: automation rate · median resolve · known rate   │
│  P2. Automation funnel        → click jumps to Now, filtered       │
│  P3. Execution outcome donut + rollback count                      │
│  P4. Volume over time (stacked known/unknown)                      │
│  P5. Breakdowns: priority · category · service                     │
├────────────────────────────────────────────────────────────────────┤
│ TAB: KNOWLEDGE  (respects time range)                              │
│  K1. KPI tiles ×3: documents · services covered · undocumented     │
│  K2. Runbook coverage gaps (known-rate by service, ascending)      │
│  K3. Documents driving resolutions                                 │
│  K4. Candidates for new documentation                              │
├────────────────────────────────────────────────────────────────────┤
│ DRAWER (on row click, any tab) — INCIDENT DETAIL                   │
│  D1. Header + AI classification w/ confidence & corrections        │
│  D2. Agent run trace                                               │
│  D3. Similar incidents (RAG matches)                               │
│  D4. Recommended + executed actions                                │
│  D5. Event timeline                                                │
│  D6. Feedback impact + feedback form                               │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3A. Alert strip

The strip is what makes the tab structure safe. Without it, moving the approval queue behind a tab is a regression, not a refinement.

- **AS-1** Mounted **above** the tab bar, inside the sticky header. It is not a tab and cannot be dismissed, collapsed, or scrolled away from.
- **AS-2** Shows exactly two counts: **P1 active** and **awaiting approval**. Nothing else earns a place here — every addition dilutes the two that matter.
- **AS-3** Three states driven by severity: `hot` (red, ≥1 P1 active) · `warm` (amber, approvals pending, no P1) · `calm` (green, both zero).
- **AS-4** **Renders a resting state instead of disappearing.** At zero it reads "No critical incidents · no approvals pending". An empty strip and a missing strip look identical, and the user can't tell whether the system is quiet or broken.
- **AS-5** Both counts are buttons. **P1 active** → switch to Now, filter to active P1. **Awaiting approval** → switch to Now, flash the approval queue.
- **AS-6** Right-aligned secondary line: age of the oldest pending approval, or an automation count when calm. Context, not a third metric.
- **AS-7** `role="status"` + `aria-live="polite"`. Not `assertive` — that would interrupt on every poll.
- **AS-8** The strip **ignores the time range**, same as the Now tab. "2 P1 active" always means right now.

---

## 3B. Tabs

| Tab | Content | Time range | Badge |
|---|---|---|---|
| **Now** (default) | Operational KPIs, approval queue, incident table | Ignored — always current | Pending approvals, red, hidden at zero |
| **Performance** | Automation KPIs, funnel, outcomes, breakdowns | Applies | None |
| **Knowledge** | Coverage gaps, document value, documentation backlog | Applies | None |

- **TB-1** Proper `tablist` / `tab` / `tabpanel` roles with `aria-selected`. Arrow-key navigation between tabs.
- **TB-2** Active tab persists in the URL (`?tab=perf`) and is restored on load, so a view can be shared.
- **TB-3** The Now badge shows pending approvals and is **hidden entirely at zero**. A badge reading "0" is noise that trains people to ignore badges.
- **TB-4** Tab switches are cheap: panels stay mounted, only visibility toggles. No refetch, no skeleton on tab change.
- **TB-5** Filter state (env, service, search, active chip) survives tab switches.

### Cross-tab filtering

Clicking a funnel stage or breakdown bar in **Performance** switches to **Now** with the filter applied. This is a deliberate context switch and has to be legible:

- **XT-1** Switch tab, apply filter, then **flash the incident table** with a brief focus ring. Without it the user sees an unexplained screen change.
- **XT-2** Scroll the table into view.
- **XT-3** Render the filter chip in a **distinct style** when it came from another tab, so its provenance is obvious.
- **XT-4** Emit a toast naming what happened: *"Jumped to Now — incidents that reached RAG match found."*
- **XT-5** The chip's × clears the filter but **does not** navigate back to Performance. Undoing a filter and undoing a navigation are different intentions.

---

## 4. Global controls

| Control | Behavior | Data |
|---|---|---|
| **Time range** | `24h` / `7d` / `30d` / `All`. Default `7d`. Applies to **Performance** and **Knowledge**. The **alert strip** and the **Now** tab always show current state regardless of range — surface this in a tooltip on the control, because it surprises people the first time. | `incidents.created_at` |
| **Environment** | Multi-select: Production / Staging / Development. Default: Production only. | `incidents.environment` |
| **Service** | Optional dropdown, all-services default. | `incidents.service_id` → `services.name` |
| **Live indicator** | Dot + "Updated 12s ago". Poll every 30s. Manual refresh button. | — |

Filters persist in the URL query string so a view can be shared/bookmarked.

---

## 5. Now tab — operational state

### N1. KPI tiles (4)

Four tiles, each: large value, label, optional delta vs. the previous equivalent period.

**These are the operational tiles only.** `P1 active` and `Awaiting approval` are deliberately *not* here — they live in the alert strip, where they're visible from every tab. Duplicating them would waste the two best slots on this row.

| # | Tile | Definition | Query |
|---|---|---|---|
| 1 | **Open incidents** | Not resolved/closed | `COUNT(*) FROM incidents WHERE status NOT IN ('RESOLVED','CLOSED')` |
| 2 | **Escalated** | Needs a decision owner. Red if > 0. | `... AND status = 'ESCALATED'` |
| 3 | **Unassigned** | Nobody owns these yet. Amber if > 0. | `... AND assigned_to IS NULL` |
| 4 | **Oldest open** | Age of the oldest active incident — catches the one everybody forgot | `MAX(now() - created_at) WHERE status NOT IN ('RESOLVED','CLOSED')` |

**Requirement:** every tile is clickable and filters the table below (deep-link via URL). A metric you can't drill into is a metric nobody trusts.

**Requirement:** these tiles ignore the time range, like the rest of the Now tab.

---

### N1b. Performance tiles (3) — *on the Performance tab*

| # | Tile | Definition | Query |
|---|---|---|---|
| 1 | **Automation rate** | % of resolved incidents closed with a successful execution and no human approval | see §6.1 |
| 2 | **Median time to resolve** | Median, not average — outliers wreck a hackathon dataset | `percentile_cont(0.5) WITHIN GROUP (ORDER BY resolved_at - created_at)` |
| 3 | **Known-incident hit rate** | % of incidents where RAG found a match | `AVG(is_known_incident::int)` |

**Requirement:** use *median* for resolution time; expose average in the tooltip. Schema §10 suggests `AVG` — override it in the UI.

**Requirement:** clicking any of these follows the cross-tab rules in §3B — switch to Now, filter, flash, toast.

---

### N2. Pending approvals queue — *the centerpiece*

The human-in-the-loop gate. If this component is good, the demo lands.

One card per `recommended_actions` row where `status = 'PROPOSED'`. Sorted by incident priority, then risk level, then age.

**Card anatomy:**

```
┌──────────────────────────────────────────────────────────────────┐
│ [P1] [HIGH RISK]              INC-1042 · payments-api · prod     │
│ Connection pool exhausted on payments-db                          │
│                                                                   │
│ Proposed: LAMBDA — restart connection pool                        │
│ AI confidence  ████████████████░░░░  0.91                         │
│                                                                   │
│ ▸ Parameters (collapsed JSON)                                     │
│ ▸ Why this action — matched INC-842 (0.97) + Runbook #42 (0.84)   │
│                                                                   │
│ Proposed 2m ago by Decision Agent v1.3                            │
│                    [ Reject ]  [ Approve & Execute ]  [ Details ] │
└──────────────────────────────────────────────────────────────────┘
```

**Requirements:**

- **AR-1** Risk badge is unmissable. `HIGH` = red fill, `MEDIUM` = amber, `LOW` = grey. Colour is never the only signal — text label always present (accessibility).
- **AR-2** Confidence rendered as a bar with the numeric value. Below a configurable threshold (default 0.70) the bar is amber and the card shows "Low confidence — review parameters."
- **AR-3** `parameters` JSONB is collapsed by default, expandable, syntax-highlighted, monospace. For `action_type = 'SQL'` the statement renders as formatted SQL, not raw JSON.
- **AR-4** **"Why this action"** expands to show the `similarity_matches` that drove it (doc title, type, score, link to `source_url`). This is the trust-builder — the AI must show its evidence.
- **AR-5** `HIGH` risk approval requires a confirm step: a modal restating the action and requiring an explicit second click. `LOW`/`MEDIUM` approve in one click.
- **AR-6** **Reject** opens a small form: required reason (free text) + optional corrected category/priority. Writes `recommended_actions.status='REJECTED'` **and** a `developer_feedback` row (`feedback_type='REJECTED'`). Rejection without a captured reason is a dead end for the learning loop — make the field required.
- **AR-7** On approve: card enters an optimistic **"Executing…"** state with a spinner and elapsed timer, driven by `executed_actions.status='RUNNING'`. On completion it resolves in place to a green success or red failure strip with the error message. **Do not** make the user refresh to learn the outcome.
- **AR-8** Every approve/reject writes `approved_by` / `approved_at` and emits the matching `incident_events` row (`ACTION_APPROVED` / `ACTION_REJECTED` / `ACTION_EXECUTED`).
- **AR-9** Empty state is a positive, not a blank: "No actions awaiting approval — 14 executed automatically in the last 7 days."
- **AR-10** Actions with `approval_required = FALSE` never appear here. They surface in the Performance tab and in the incident timeline only.

---

### N3. Active incidents table

Default filter: `status NOT IN ('RESOLVED','CLOSED')`. Sorted by priority, then `created_at` desc.

| Column | Source | Notes |
|---|---|---|
| Priority | `incidents.priority` | Coloured pill |
| Status | `incidents.status` | Pill; `ESCALATED` visually distinct from `OPEN` |
| Title | `incidents.title` | Truncated, full text on hover |
| Service | `services.name` | |
| Env | `incidents.environment` | Non-prod de-emphasised |
| Category | `incidents.category` | |
| Known | `incidents.is_known_incident` | ✓ icon + similarity score of best match |
| AI conf. | `incidents.confidence_score` | Compact bar |
| Age | `now() - created_at` | Turns amber past a per-priority threshold (P1: 30m, P2: 2h, P3: 8h, P4: 24h) |
| Assignee | `incidents.assigned_to` | Avatar/initials; "Unassigned" is styled as a warning |
| Automation | derived | Icon: 🤖 fully automated · 👤 human-approved · ⚠️ needs human · — none |

**Requirements:**

- **IT-1** Row click opens the detail drawer (§7). Never a full page navigation — losing dashboard context is the main complaint about tools like this.
- **IT-2** Column-header sort on priority, age, confidence.
- **IT-3** Free-text search across `title`, `description`, `external_id`.
- **IT-4** Toggle: "Include resolved" — extends the filter to all statuses within the active time range.
- **IT-5** Paginate at 25 rows; `LIMIT/OFFSET` server-side, not client filtering.
- **IT-6** Source badge (`Email` / `Slack` / `PagerDuty` / `API` / `Manual`) as a small icon in the title cell.

---

## 6. Performance tab — AI & automation

### P2. Automation funnel

Horizontal funnel, absolute counts + % of stage above:

```
Incidents received          142
  ├─ Classified by AI       142   (100%)
  ├─ RAG match found         98    (69%)
  ├─ Action recommended      87    (61%)
  ├─ Approved / auto-run     79    (91% of recommended)
  ├─ Executed successfully   71    (90% of executed)
  └─ Validated + resolved    68    (96% of successful)
```

**Requirement:** each stage is clickable → filters the incident table to incidents that reached but did not pass that stage. This turns the funnel from a vanity chart into a triage tool ("show me the 8 that failed execution").

**Requirement:** the biggest stage-to-stage drop is annotated automatically ("Largest drop: RAG match → recommendation, −11").

#### 6.1 Automation rate definition

Ambiguity here will cause arguments, so fix it in the spec:

```sql
-- "Fully automated" = resolved, had a successful execution,
-- and never required human approval.
WITH resolved AS (
  SELECT i.id
  FROM incidents i
  WHERE i.status IN ('RESOLVED','CLOSED')
    AND i.created_at >= :from
),
automated AS (
  SELECT DISTINCT ra.incident_id
  FROM recommended_actions ra
  JOIN executed_actions ea ON ea.recommended_action_id = ra.id
  WHERE ea.status = 'SUCCESS'
    AND ra.approval_required = FALSE
)
SELECT
  COUNT(*) FILTER (WHERE r.id IN (SELECT incident_id FROM automated)) * 100.0
  / NULLIF(COUNT(*), 0) AS automation_rate
FROM resolved r;
```

The UI shows two adjacent numbers, because conflating them hides the truth:

- **Fully automated %** — no human touched it.
- **Human-assisted %** — AI proposed, human approved, execution succeeded.

---

### P3. Execution outcomes

Donut over `executed_actions.status`: `SUCCESS` / `FAILED` / `ROLLED_BACK` / `RUNNING`. Centre label = success rate.

**Requirements:**

- **EO-1** `ROLLED_BACK` is called out separately with its own count — it is not a success and not a plain failure. Silent rollbacks are the scariest failure mode for auto-remediation.
- **EO-2** Below the donut, a compact list of the most recent failures: action type, incident, truncated `error_message`, link to the drawer.
- **EO-3** Breakdown by `action_type` (SQL / LAMBDA / API / GITHUB_PR / KUBERNETES) available on toggle — reveals which automation class is unreliable.
- **EO-4** Median execution duration (`finished_at - started_at`) shown as a caption.

---

### P4. Incident volume over time

Stacked bar (day buckets for 7d/30d, hour buckets for 24h): **known** vs **unknown** incidents.

**Requirement:** overlay a line for median resolution time on a secondary axis. The story the manager wants is "volume went up but resolution time held flat" — that needs both series in one frame.

---

### P5. Breakdowns

Three compact charts side by side, all click-to-filter:

- **By priority** — horizontal bars P1→P4.
- **By category** — horizontal bars, descending, top 6 + "Other".
- **By service** — top 5 noisiest services, with each service's known-rate shown inline. A service with high volume *and* low known-rate is where the runbook gap is.

---

## 7. Incident detail drawer

Right-side slide-over, ~55% viewport width. Dashboard stays visible and interactive behind a scrim. `Esc` and click-outside close it. Deep-linkable at `/?incident=<id>`.

### D1. Header
`external_id` · title · status pill · priority pill · service · environment · assignee · created/resolved timestamps · source badge.
Actions: `Assign to me`, `Change priority`, `Escalate`, `Mark resolved`.

### D2. AI classification
Category, priority, and confidence as the AI determined them. If a `developer_feedback` row has `corrected_category` or `corrected_priority`, show **AI said X → human corrected to Y** side by side. Surfacing corrections is how the model earns or loses trust.

### D3. Agent run trace
Vertical list from `agent_runs`, ordered by `started_at`:

| Element | Source |
|---|---|
| Agent name + version | `agents.name`, `agents.version` |
| Status chip | `agent_runs.status` |
| Duration | `finished_at - started_at` (or `latency_ms`) |
| Confidence | `agent_runs.confidence_score` |
| Input / Output | `input` / `output` JSONB — collapsed, expandable |
| Error | `error_message`, shown expanded when `status='FAILED'` |

**Requirement:** `FAILED` runs are expanded by default with the error visible. Everything else collapses.

### D4. Similar incidents (RAG)
From `similarity_matches` joined to `knowledge_documents`, descending by score. Each row: doc-type badge, title, score bar, snippet from `summary`, external link to `source_url`. Cap at 5 with "show all".

### D5. Actions
Recommended actions with their execution results nested underneath. Each shows: type, description, risk, confidence, status, approver + timestamp, and — for executed ones — duration, `response_payload` (collapsed) and `execution_logs` (collapsed, monospace, scrollable).

Pending actions render the same approve/reject controls as §A2 with identical behavior.

### D6. Event timeline
Chronological `incident_events` feed. Icon per `event_type`, human-readable `description`, relative + absolute timestamp, `created_by` (agent / user / system). `payload` JSONB expandable per row.

**Requirements:**

- **TL-1** Toggle "Agent events only" to filter noise.
- **TL-2** Failure events (`VALIDATION_FAILED`, `ACTION_REJECTED`, `ESCALATED`) are visually flagged.
- **TL-3** Cumulative elapsed time from `INCIDENT_CREATED` shown on each event — makes "where did the time go" answerable at a glance.

### D7. Feedback impact + form

Always-available form: feedback type (Approved / Rejected / Corrected), comments, optional corrected category/priority/resolution. Writes `developer_feedback`. Existing feedback listed above the form.

Above the form sits the **feedback impact widget** — the only motivational pattern in this product:

> **Your corrections are training the classifier**
> **84%** classification accuracy, up from 71%
> `▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░`
> 12 corrections submitted · last one 3 days ago
> *Team total: 61 corrections this quarter across 4 engineers.*

**Why this one and not others.** Submitting feedback is the single hardest behaviour to get from engineers, and it's the input the entire learning loop depends on. This widget rewards exactly that behaviour with a real, verifiable outcome — not an invented point score. See §13 for the patterns rejected.

**Requirements:**

- **FI-1** The accuracy figure must be **real and derivable**: agreement rate between `agent_runs.output` classification and any `developer_feedback.corrected_category` / `corrected_priority` for the same incident, over the selected window.
- **FI-2** Show the **team total** alongside the personal count. Personal-only framing slides toward competition; team framing keeps it collaborative.
- **FI-3** Never show a **decline** as a personal failure. If accuracy dropped, attribute it to the model or the period, never to the user's feedback.
- **FI-4** Suppress the widget entirely when the sample is too small to be meaningful (< 10 corrections team-wide). A number computed from 2 data points is a lie with a progress bar.
- **FI-5** No streaks, no badges, no leaderboard, no ranking. See §13.

---

## 7A. Knowledge tab

Emerged from the funnel: the largest stage-to-stage drop is *RAG match found*, which is a content problem, not a model problem. This tab makes the content problem actionable and gives it to a different owner.

### K1. KPI tiles (3)

| Tile | Definition | Query |
|---|---|---|
| **Knowledge documents** | Indexed chunks and document-type spread | `COUNT(*) FROM knowledge_embeddings` + `COUNT(DISTINCT document_type)` |
| **Services with a runbook** | Services having ≥1 `RUNBOOK` doc matched in the window | join `similarity_matches` → `knowledge_documents` where `document_type='RUNBOOK'` |
| **Undocumented resolutions** | Resolved incidents with no RAG match and no postmortem written | `incidents WHERE is_known_incident=FALSE AND status IN ('RESOLVED','CLOSED')` with no `knowledge_documents.incident_id` |

### K2. Runbook coverage gaps

Horizontal bars: known-incident rate per service, **sorted ascending** — worst first. Bar colour: red < 60%, amber 60–80%, green > 80%.

**Requirement:** sort ascending, not by volume. The point of this chart is "what's broken", and burying the worst service at the bottom defeats it.

**Requirement:** caption names the highest-leverage fix explicitly, e.g. *"Fixing auth-gateway would move the funnel more than any model change."* A chart that requires the reader to do the inference usually doesn't get read.

### K3. Documents driving resolutions

Ranked list from `similarity_matches` joined to resolved incidents: doc type badge, title, and resolution count. Answers which documents earn their place — and, by omission, which are dead weight.

### K4. Candidates for new documentation

The learning backlog. Resolved incidents with `is_known_incident = FALSE`, plus repeat incidents that still have no runbook. Each row: incident ID, title, service, and why it qualifies (manual resolution time, recurrence count). Row click opens the drawer.

**Requirement:** show recurrence count where > 1. An incident that happened three times with no runbook is the strongest possible argument for writing one.

---

## 8. Cross-cutting requirements

### States

| State | Requirement |
|---|---|
| **Loading** | Skeleton placeholders matching final layout. No spinners-on-blank and no layout shift on load. |
| **Empty (no data)** | Explain what will appear and how it gets there ("Incidents arrive from email and PagerDuty"). Never a bare "No data". |
| **Empty (filtered)** | Distinguish from no-data: "No incidents match these filters" + one-click clear. |
| **Error** | Per-component failure, not whole-page. A failed chart shows an inline retry; the rest of the dashboard still works. |
| **Stale** | If polling fails, banner: "Last updated 4m ago — reconnecting." Never show stale numbers as if they were live. |

### Behavior

- **X-1 Optimistic updates** on approve/reject; roll back the UI with a clear error toast if the write fails.
- **X-2 Polling** at 30s for the alert strip and the Now tab — the strip polls even while another tab is active, otherwise the badge and counts go stale exactly when they matter. Performance and Knowledge refresh on filter change and every 5 minutes.
- **X-3 No layout jump** when polled numbers change. Animate value transitions.
- **X-4 Idempotent approvals** — the Approve button disables immediately on click to prevent double-execution. Critical: a double-fired remediation Lambda is a real outage.
- **X-5 Timestamps** show relative by default ("4m ago"), absolute with timezone on hover.

### Accessibility

- **A11Y-1** Colour never the sole carrier of meaning — every priority/risk/status pill has a text label.
- **A11Y-2** WCAG AA contrast on all pills and charts.
- **A11Y-3** Full keyboard path: tab through approval cards, `Enter` to open detail, `Esc` to close drawer.
- **A11Y-4** Charts have accessible table equivalents (`aria-describedby` or a "view as table" toggle).

### Performance

- **P-1 First meaningful paint under 2s** on the seeded hackathon dataset.
- **P-2** KPI tiles render before charts — progressive, independent component loads.
- **P-3** Every aggregate served by a single query; no N+1 per-incident calls in the table. The indexes in schema §10 (`status`, `priority`, `service_id`, `created_at`, `category`) cover the required filters.
- **P-4** JSONB payloads (`input`, `output`, `parameters`, `execution_logs`) are fetched lazily on expand, never in list responses. These can be large enough to make the table crawl.

---

## 9. API surface

| Endpoint | Returns | Tab |
|---|---|---|
| `GET /api/dashboard/alert-strip` | **P1 active + pending approvals only.** Deliberately its own tiny endpoint: it polls on a 30s cadence independent of whichever tab is open, and must never be blocked behind a heavier aggregate query. | all |
| `GET /api/dashboard/now?env&service` | The 4 operational tiles. No `from`/`to` — always current. | Now |
| `GET /api/dashboard/performance?from&to&env&service` | The 3 automation tiles + funnel + outcomes | Performance |
| `GET /api/dashboard/breakdowns?from&to&env` | priority / category / service / volume series | Performance |
| `GET /api/dashboard/knowledge?from&to` | Coverage by service, top documents, documentation candidates | Knowledge |
| `GET /api/incidents?status&priority&service&env&q&stage&page` | Paginated table rows (no JSONB). `stage` supports funnel filtering. | Now |
| `GET /api/incidents/:id` | Full detail: events, agent_runs, matches, actions, feedback | drawer |
| `GET /api/approvals/pending` | Pending action cards incl. top similarity matches | Now |
| `GET /api/feedback/impact?user&from&to` | Personal + team correction counts and classifier agreement rate (FI-1) | drawer |
| `POST /api/actions/:id/approve` | Sets APPROVED, triggers execution, writes event | Now |
| `POST /api/actions/:id/reject` | Sets REJECTED, writes `developer_feedback` + event | Now |
| `GET /api/actions/:id/execution` | Poll target for live execution status | Now |
| `POST /api/incidents/:id/feedback` | Writes `developer_feedback` | drawer |

**Note on the strip endpoint.** Splitting it out is not premature optimisation. The strip is the one thing that must stay accurate while the user sits on another tab; coupling it to a query that aggregates 30 days of funnel data guarantees it eventually goes stale under load.

---

## 10. Schema gaps this UI exposes

Recommend adding before build; each is small and each blocks a stated requirement:

1. **`agent_runs`: promote the optional metrics to real columns** — `latency_ms`, `tokens_input`, `tokens_output`, `model`, `prompt_version`. Required for D3 duration and any future cost view.
2. **`recommended_actions.rejection_reason`** — AR-6 currently has to round-trip through `developer_feedback.comments`, which loses the direct link.
3. **`incidents.first_response_at`** — MTTR alone hides whether the delay was detection or fixing. One timestamp splits the funnel meaningfully.
4. **A validation record** — `VALIDATION_PASSED/FAILED` exists only as an event type, so the funnel's last stage has to be inferred from JSONB. Either add `executed_actions.validation_status` or a small `validations` table.
5. **`services.criticality`** — lets the service breakdown weight a payments outage above an internal tool.

None are blockers for a demo; items 1 and 4 are the ones worth doing.

---

## 11. Acceptance criteria

The build is done when:

1. All KPI tiles show correct values against the seeded dataset and each drills into a filtered table.
2. A pending HIGH-risk action can be approved through the confirm modal, and the card transitions Executing → Success/Failure without a page refresh.
3. Rejecting an action requires a reason and writes both `recommended_actions.status` and a `developer_feedback` row.
4. The funnel's stage counts reconcile exactly with the incident table when each stage is clicked.
5. `ROLLED_BACK` executions are counted separately from `SUCCESS` and `FAILED` everywhere they appear.
6. The detail drawer renders the agent trace, RAG matches, actions, and full event timeline for any incident, with `FAILED` runs expanded by default.
7. Time-range and environment filters apply consistently to Performance and Knowledge, and persist in the URL.
8. Every component has a distinct loading, empty, filtered-empty, and error state.
9. Approve is idempotent — a double-click cannot execute twice.
10. Full keyboard traversal of the approval queue and drawer.

**Added in v2.0 — the tab structure is only correct if all of these hold:**

11. **The alert strip is visible and accurate on all three tabs.** Switching tabs never changes its values.
12. **The strip keeps polling while another tab is active.** Sit on Performance for two minutes, seed a new P1, and the strip updates without a tab switch or manual refresh.
13. **The strip renders its calm state at zero** rather than disappearing.
14. **The Now badge matches the approval queue count exactly**, and is hidden — not showing "0" — when empty.
15. **Cross-tab filtering is legible**: clicking a funnel stage switches to Now, applies the filter, flashes the table, shows a distinctly-styled chip, and emits a toast naming what happened.
16. **Clearing a cross-tab filter does not navigate back** to the originating tab.
17. **Filter and search state survive tab switches** in both directions.
18. **Tab state round-trips through the URL** — copy the URL on Knowledge, open it in a new window, land on Knowledge.
19. **In-flight execution state survives re-render.** Approve two actions, reject a third while the first two are still running, and both running cards keep their live timers. *(This was a real bug in v1 — the queue re-render destroyed sibling card DOM.)*
20. **The feedback impact widget is suppressed below 10 team-wide corrections** and never frames a decline as the user's fault.

### Instrumentation to settle the tab debate empirically

The argument for keeping the queue outside the tabs is a prediction, and predictions should be checked. Instrument from day one:

```sql
-- Time from recommendation to human decision.
-- If the median rises after any navigation change, the change hurt.
SELECT percentile_cont(0.5) WITHIN GROUP (
         ORDER BY ra.approved_at - ra.created_at
       ) AS median_time_to_approval
FROM recommended_actions ra
WHERE ra.approval_required = TRUE
  AND ra.approved_at IS NOT NULL
  AND ra.created_at >= :from;
```

Track alongside it: % of approvals arriving after a `DEVELOPER_NOTIFIED` page vs. found unprompted in the UI. If that ratio climbs, the UI has stopped surfacing work and the pager is carrying it.

---

## 12. Build order

| Phase | Scope | Why first |
|---|---|---|
| **1** | Alert strip + Now tab (KPIs, table, drawer read-only) | Proves the data model *and* establishes the one component that can't regress |
| **2** | Approval queue with approve/reject + live execution state | The demo moment; highest value per hour |
| **3** | Performance tab: funnel + execution donut + cross-tab filtering | The trust argument |
| **4** | Knowledge tab + feedback impact widget | Closes the learning loop |
| **5** | Breakdowns, volume trend, polish: a11y, empty/error states, polling | Ship quality |

Build the strip in phase 1, not phase 5. It is load-bearing for every decision after it — retrofitting it means redoing the header, the polling strategy, and the tab layout at once.

If time runs short, phases 1–2 alone are a coherent, demoable product. Phase 3 is what convinces anyone it's more than a UI.

---

## 13. Rejected patterns

Recorded so these don't get re-proposed each sprint.

### Navigation

| Rejected | Why |
|---|---|
| **Approval queue behind its own tab** | Hides work that blocks resolution. A badge tells you *that* three actions are pending, not that one is a HIGH-risk P1 in production — and choosing which to approve first is the actual job. Triage needs comparison; a single number can't be compared. |
| **Tabs with no persistent strip** | Shifts the burden to prospective memory ("remember to check"), which is the most fragile kind and collapses under cognitive load — exactly the condition an on-call engineer is in. |
| **Drawer as a full page or a tab** | Loses list context, which is the main complaint about tools in this category. |
| **Role-based views (engineer vs. manager)** | Needs RBAC we don't have, and hides the operational state from the person most able to act on it. Revisit only if Performance grows past ~6 charts or team-performance data becomes sensitive. |

### Gamification

Most gamification patterns are actively harmful in incident response, because the thing being measured is also the thing being gamed.

| Rejected | Why |
|---|---|
| **Leaderboard of incidents resolved** | Causes hoarding, penalises whoever takes the hard incidents, and discourages asking for help. |
| **Anything rewarding speed of closure** | People close prematurely or downgrade severity to protect their MTTR. You end up optimising the metric and degrading the work. |
| **Streaks on an on-call rotation** | Ties personal achievement to constant availability. That's a burnout mechanism, not a motivator. |
| **Points / XP for approvals** | Creates pressure to approve. The entire value of the human gate is the willingness to say no. |
| **Badges for closing P1s** | Rewards being present for a bad event, which is luck, and implicitly rewards incidents happening. |

**What was kept, and the principle behind it:** the two patterns that survived — the clearable queue (§N2, AR-9) and the feedback impact widget (§D7) — both reward a behaviour we actually want with an outcome that is real and verifiable from the database. Neither invents a score, neither ranks people against each other, and neither creates pressure to act when the correct action is to wait.
