# UI PRD — AI Incident Response Orchestrator Dashboard

**Version:** 1.0
**Date:** 2026-08-12
**Owner:** Fran Collado
**Depends on:** `ai_incident_response_database_schema.md`
**Scope:** Single-page summary dashboard (MVP / hackathon)

---

## 1. Summary

A single dashboard that answers two questions at a glance:

1. **"What needs a human right now?"** — live incident queue and pending AI action approvals.
2. **"Is the AI actually working?"** — automation rate, execution success, and known-incident hit rate.

The dashboard is the primary demo surface for the orchestrator. It must make the AI's reasoning visible, not hidden, and it must let a human approve or reject a proposed action without leaving the page.

### Non-goals (v1)

- Incident creation/editing from the UI (incidents arrive via email/monitoring/API).
- Knowledge base authoring or runbook editing.
- User management, RBAC, on-call rotations, SLA config.
- Historical report export.

---

## 2. Users

| Persona | Job on this screen | Success looks like |
|---|---|---|
| **On-call engineer** (primary, operational) | Triage the open queue, approve/reject AI-proposed actions, inspect what the AI did | Clears the approval queue in under 60s; never has to open the DB to understand an incident |
| **Eng manager / SRE lead** (primary, analytical) | Judge whether automation is trustworthy and where incidents concentrate | Can state this week's automation rate, MTTR, and top failing service without asking anyone |

Both share one screen. Layout is split: **operational band on top** (engineer), **performance band below** (manager). No role switching in v1 — the manager scrolls past the queue, the engineer ignores the trend charts.

---

## 3. Information architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ HEADER: title · environment filter · time range · live indicator   │
├────────────────────────────────────────────────────────────────────┤
│ BAND A — OPERATIONAL STATE                                         │
│  A1. KPI strip (6 tiles)                                           │
│  A2. Pending approvals queue  ← highest-value component            │
│  A3. Active incidents table (filterable)                           │
├────────────────────────────────────────────────────────────────────┤
│ BAND B — AI & AUTOMATION PERFORMANCE                               │
│  B1. Automation funnel                                             │
│  B2. Execution outcome donut + rollback count                      │
│  B3. Incident volume over time (stacked known/unknown)             │
│  B4. Breakdown: by priority · by category · by service             │
├────────────────────────────────────────────────────────────────────┤
│ DRAWER (on row click) — INCIDENT DETAIL                            │
│  D1. Header + AI classification w/ confidence                      │
│  D2. Agent run trace                                               │
│  D3. Similar incidents (RAG matches)                               │
│  D4. Recommended + executed actions                                │
│  D5. Event timeline                                                │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4. Global controls

| Control | Behavior | Data |
|---|---|---|
| **Time range** | `24h` / `7d` / `30d` / `All`. Default `7d`. Filters all of Band B and the volume chart. Band A always shows *current* state regardless of range. | `incidents.created_at` |
| **Environment** | Multi-select: Production / Staging / Development. Default: Production only. | `incidents.environment` |
| **Service** | Optional dropdown, all-services default. | `incidents.service_id` → `services.name` |
| **Live indicator** | Dot + "Updated 12s ago". Poll every 30s. Manual refresh button. | — |

Filters persist in the URL query string so a view can be shared/bookmarked.

---

## 5. Band A — Operational state

### A1. KPI strip

Six tiles, each: large value, label, and a delta vs. previous equivalent period (↑ red / ↓ green as appropriate).

| # | Tile | Definition | Query |
|---|---|---|---|
| 1 | **Open incidents** | Not resolved/closed | `COUNT(*) FROM incidents WHERE status NOT IN ('RESOLVED','CLOSED')` |
| 2 | **P1 active** | Critical open. Tile turns red if > 0. | `... AND priority = 'P1'` |
| 3 | **Awaiting approval** | Actions blocking on a human. Amber if > 0. | `COUNT(*) FROM recommended_actions WHERE status='PROPOSED' AND approval_required=TRUE` |
| 4 | **Automation rate** | % of resolved incidents closed with an executed action and no rejection/correction | see §6.1 |
| 5 | **Median time to resolve** | Median, not average — outliers skew a hackathon dataset badly | `percentile_cont(0.5) WITHIN GROUP (ORDER BY resolved_at - created_at)` |
| 6 | **Known-incident hit rate** | % of incidents where RAG found a match | `AVG(is_known_incident::int)` |

**Requirement:** every tile is clickable and filters the incident table below to that subset (deep-link via URL). A metric you can't drill into is a metric nobody trusts.

**Requirement:** use *median* for resolution time in the tile; expose average in the tooltip. Schema §10 suggests `AVG` — override it in the UI.

---

### A2. Pending approvals queue — *the centerpiece*

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
- **AR-10** Actions with `approval_required = FALSE` never appear here. They surface in Band B and in the incident timeline only.

---

### A3. Active incidents table

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

## 6. Band B — AI & automation performance

### B1. Automation funnel

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

### B2. Execution outcomes

Donut over `executed_actions.status`: `SUCCESS` / `FAILED` / `ROLLED_BACK` / `RUNNING`. Centre label = success rate.

**Requirements:**

- **EO-1** `ROLLED_BACK` is called out separately with its own count — it is not a success and not a plain failure. Silent rollbacks are the scariest failure mode for auto-remediation.
- **EO-2** Below the donut, a compact list of the most recent failures: action type, incident, truncated `error_message`, link to the drawer.
- **EO-3** Breakdown by `action_type` (SQL / LAMBDA / API / GITHUB_PR / KUBERNETES) available on toggle — reveals which automation class is unreliable.
- **EO-4** Median execution duration (`finished_at - started_at`) shown as a caption.

---

### B3. Incident volume over time

Stacked bar (day buckets for 7d/30d, hour buckets for 24h): **known** vs **unknown** incidents.

**Requirement:** overlay a line for median resolution time on a secondary axis. The story the manager wants is "volume went up but resolution time held flat" — that needs both series in one frame.

---

### B4. Breakdowns

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

### D7. Feedback
Always-available form: feedback type (Approved / Rejected / Corrected), comments, optional corrected category/priority/resolution. Writes `developer_feedback`. Existing feedback listed above the form.

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
- **X-2 Polling** at 30s for Band A; Band B refreshes on filter change and every 5 minutes.
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

| Endpoint | Returns |
|---|---|
| `GET /api/dashboard/summary?from&to&env&service` | All six KPI tiles in one payload |
| `GET /api/dashboard/funnel?from&to&env` | Funnel stage counts |
| `GET /api/dashboard/breakdowns?from&to&env` | priority / category / service / volume series |
| `GET /api/dashboard/executions?from&to` | Outcome counts, by-type split, recent failures |
| `GET /api/incidents?status&priority&service&env&q&page` | Paginated table rows (no JSONB) |
| `GET /api/incidents/:id` | Full detail: events, agent_runs, matches, actions, feedback |
| `GET /api/approvals/pending` | Pending action cards incl. top similarity matches |
| `POST /api/actions/:id/approve` | Sets APPROVED, triggers execution, writes event |
| `POST /api/actions/:id/reject` | Sets REJECTED, writes `developer_feedback` + event |
| `GET /api/actions/:id/execution` | Poll target for live execution status |
| `POST /api/incidents/:id/feedback` | Writes `developer_feedback` |

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

1. All six KPI tiles show correct values against the seeded dataset and each drills into a filtered table.
2. A pending HIGH-risk action can be approved through the confirm modal, and the card transitions Executing → Success/Failure without a page refresh.
3. Rejecting an action requires a reason and writes both `recommended_actions.status` and a `developer_feedback` row.
4. The funnel's stage counts reconcile exactly with the incident table when each stage is clicked.
5. `ROLLED_BACK` executions are counted separately from `SUCCESS` and `FAILED` everywhere they appear.
6. The detail drawer renders the agent trace, RAG matches, actions, and full event timeline for any incident, with `FAILED` runs expanded by default.
7. Time-range and environment filters apply consistently to Band B and persist in the URL.
8. Every component has a distinct loading, empty, filtered-empty, and error state.
9. Approve is idempotent — a double-click cannot execute twice.
10. Full keyboard traversal of the approval queue and drawer.

---

## 12. Build order

| Phase | Scope | Why first |
|---|---|---|
| **1** | KPI strip + incident table + detail drawer (read-only) | Proves the data model end to end |
| **2** | Approval queue with approve/reject + live execution state | The demo moment; highest value per hour |
| **3** | Automation funnel + execution donut | The trust argument |
| **4** | Breakdowns, volume trend, feedback form | Rounds out the manager view |
| **5** | Polish: a11y, empty/error states, polling | Ship quality |

If time runs short, phases 1–2 alone are a coherent, demoable product. Phase 3 is what convinces anyone it's more than a UI.
