# Data Model: AI Incident Response Orchestrator Dashboard

Every field below is sourced from a specific PRD passage (cited inline). Fields marked
**[INFERRED]** are needed by a functional requirement but are not named verbatim anywhere in the
PRD text — per Constitution I, they are not authored here as fact, only as the shape the mock/MSW
fixtures and the real client's TypeScript types must agree on until
`ai_incident_response_database_schema.md` is available to reconcile against. None of the API
contracts in `contracts/` invent a field beyond what is listed here.

This is a read model for the UI, not a schema migration — it exists to give `api/types.ts` a single
source of truth. **Revised for PRD v2.0** (persistent alert strip + tabs); FR numbers below match
spec.md's post-re-spec numbering (FR-001–FR-121), not the earlier v1.0 numbering.

## Incident

Source: PRD §N3 table, §D1, §10.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Internal identifier. **Addressing key** — the deep link (FR-059) and every API path use this, never `external_id`. |
| `external_id` | string | Display value only (e.g. `INC-1042`). Searchable (FR-051), never used for addressing (FR-059). |
| `title` | string | Truncated in the table, full on hover (§N3). |
| `description` | string | Searchable (FR-051); not shown in the table. |
| `status` | enum | At least `OPEN`, `ESCALATED`, `INVESTIGATING`, `MITIGATED`, `RESOLVED`, `CLOSED` — the last four are directly observed in the PRD v2 prototype's own mock data (`INVESTIGATING`/`MITIGATED` are new since v1.0; `RESOLVED`/`CLOSED`/`ESCALATED`/`OPEN` carry over). `ESCALATED` is visually distinct from `OPEN` (§N3); all of `OPEN`/`ESCALATED`/`INVESTIGATING`/`MITIGATED` count as "not resolved/closed" for the Open Incidents tile (N1 #1). Full enum **[INFERRED]** beyond these six. |
| `priority` | enum `P1`\|`P2`\|`P3`\|`P4` | N1, §N3. |
| `environment` | enum `Production`\|`Staging`\|`Development` | §4. |
| `category` | string | Open vocabulary; P5 shows top-6-plus-Other, implying no fixed enum. |
| `service_id` | string → `Service.id` | §N3. |
| `assigned_to` | string \| null | Null renders as "Unassigned" styled as a warning, not blank (§N3). Drives the Now tab's "Unassigned" tile (N1 #3). |
| `confidence_score` | number (0–1) \| null | AI classification confidence (§N3, §D2). |
| `is_known_incident` | boolean | Drives the known-incident hit rate tile and the ✓ icon (N1b #3, §N3). |
| `source` | enum `Email`\|`Slack`\|`PagerDuty`\|`API`\|`Manual` | IT-6. |
| `created_at` | timestamp | Drives age (FR-055) and the time-range filter (§4); the Now tab's "Oldest open" tile (N1 #4) is `MAX(now() - created_at)` over non-resolved/closed incidents. |
| `resolved_at` | timestamp \| null | Feeds median/average resolution time (N1b #2). |
| `first_response_at` | timestamp \| null | **[GAP — PRD §10 item 1]**. Not required by any FR in this spec; not fetched or displayed. Listed here only so it is not silently added later without a citation. |

**Validation**: none of the above are user-editable directly except through the incident-update
operation (see `contracts/incidents-endpoints.md`), which is itself gated on FR-062.

## Service

Source: PRD §N3, §P5, §K2, §10 item 5.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | Shown in the table, the service breakdown (§N3, §P5), and the Knowledge tab's coverage-gap chart (§K2). |
| `criticality` | — | **[GAP — PRD §10 item 5]**. Not in scope; no FR requires it. |

## RecommendedAction

Source: PRD §N2, §D5, §10 item 2.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `incident_id` | string → `Incident.id` | |
| `action_type` | enum `SQL`\|`LAMBDA`\|`API`\|`GITHUB_PR`\|`KUBERNETES` | EO-3. |
| `description` | string | Card body (§N2). |
| `risk_level` | enum `LOW`\|`MEDIUM`\|`HIGH` | AR-1. |
| `confidence_score` | number (0–1) | AR-2. |
| `approval_required` | boolean | `FALSE` rows never enter the queue (AR-10, FR-032). |
| `status` | enum `PROPOSED`\|`APPROVED`\|`REJECTED` | Terminal once `APPROVED`/`REJECTED` (AR-6, AR-8). |
| `approved_by` | string \| null | Operator name per FR-119, written on approve **or** reject. |
| `approved_at` | timestamp \| null | |
| `rejection_reason` | string | **[GAP — PRD §10 item 2 / Assumption 6]**. No dedicated column exists yet; the reason is carried on the linked `DeveloperFeedback.comments` row instead. `api/types.ts` still exposes `rejectionReason` on the UI-side type — the contract in `contracts/approvals-endpoints.md` documents which storage it actually reads from today. |
| `parameters` | JSON | **Lazy-loaded on expand only (P-4)** — never present on the list/queue payload; fetched via the incident-detail or action-detail call. For `action_type = 'SQL'`, this JSON's statement field is what `sql-formatter` pretty-prints (AR-3). |

**Parameters shape for `SQL`** (informative, not exhaustive — the JSON is opaque beyond needing a
`statement` string to format): `{ statement: string, ...driver-specific fields }`.

**Lifecycle**: `PROPOSED → APPROVED` (triggers an `ExecutedAction`) or `PROPOSED → REJECTED`
(terminal, writes `DeveloperFeedback`). No other transition exists. **Rendering note (FR-042):** a
card resolving to `APPROVED`/`REJECTED`/`gone` must never disturb the DOM identity of a sibling card
still `RUNNING` — this is a component-key/re-render concern (component-inventory.md), not a
data-model concern, but is noted here because it is keyed off this same lifecycle.

## ExecutedAction

Source: PRD §N2, §P3, §D5, §10 item 4.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `recommended_action_id` | string → `RecommendedAction.id` | |
| `status` | enum `RUNNING`\|`SUCCESS`\|`FAILED`\|`ROLLED_BACK` | `ROLLED_BACK` is its own terminal bucket, never derived from `FAILED` (EO-1). |
| `started_at` | timestamp | |
| `finished_at` | timestamp \| null | Null while `RUNNING`. Median execution duration (EO-4) is computed from this pair. |
| `error_message` | string \| null | Shown on `FAILED` (AR-7, EO-2). |
| `response_payload` | JSON | **Lazy-loaded on expand only (P-4).** |
| `execution_logs` | string (monospace, scrollable) | **Lazy-loaded on expand only (P-4).** |
| `validation_status` | — | **[GAP — PRD §10 item 4]**. No validation record exists. The funnel's "Validated + resolved" stage (FR-083) is therefore rendered as explicitly unavailable (Assumption 5) rather than inferred from `incident_events` payloads. |

**Lifecycle**: `RUNNING → SUCCESS \| FAILED \| ROLLED_BACK`. FR-041 governs the UI's behavior if no
transition is observed within 2 minutes — this is a display-layer timeout, not a data-model state.

## AgentRun

Source: PRD §D3, §10 item 1.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `incident_id` | string → `Incident.id` | |
| `agent_name` | string | §D3 table. |
| `agent_version` | string | §D3 table. |
| `status` | enum, at least `SUCCESS`\|`FAILED` | Drives default-expand rule (FR-065). |
| `started_at` | timestamp | Ordering key (§D3: "ordered by `started_at`"). |
| `finished_at` | timestamp \| null | Duration = `finished_at - started_at` when both present. |
| `latency_ms` | number \| null | **[GAP — PRD §10 item 1: "optional metrics" not yet promoted to real columns]**. When absent, duration is derived from the timestamp pair (Assumption 7, `domain/timeline.ts`'s duration helper — see component-inventory.md). |
| `confidence_score` | number (0–1) \| null | |
| `input` | JSON | **Lazy-loaded on expand only (P-4).** |
| `output` | JSON | **Lazy-loaded on expand only (P-4).** Also the source of the "AI said" side of the feedback-impact accuracy comparison (FR-075) — see `DeveloperFeedback` below. |
| `error_message` | string \| null | Shown expanded when `status = 'FAILED'` (FR-065). |

`tokens_input`, `tokens_output`, `model`, `prompt_version` are the remaining PRD §10 item 1 gap
fields; no FR in this spec displays them, so they are not part of this feature's read model.

## SimilarityMatch

Source: PRD §D4.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `incident_id` | string → `Incident.id` | |
| `knowledge_document_id` | string → `KnowledgeDocument.id` | |
| `score` | number (0–1) | Sort key, descending (§D4). |

## KnowledgeDocument

Source: PRD §D4, §K3, §K4.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `type` | enum, at least `INCIDENT`\|`RUNBOOK`\|`POSTMORTEM`\|`GITHUB_ISSUE`\|`DOCUMENTATION`\|`TROUBLESHOOTING_GUIDE` | Values observed across PRD §N2's worked example, §D4's badge requirement, and the v2 prototype's Knowledge-tab document list (`TROUBLESHOOTING_GUIDE` is new since v1.0). Full enum **[INFERRED]**. |
| `summary` | string | Snippet shown per match (§D4). |
| `source_url` | string (URL) | External link — MUST render with `rel="noopener noreferrer"` (Constitution XIII). |
| `resolution_count` | number | **[INFERRED — new for v2.0]**. Count of resolved incidents this document is linked to via `SimilarityMatch`; drives the Knowledge tab's "Documents driving resolutions" ranking (K3). Computed, not stored — listed here as the shape `contracts/dashboard-endpoints.md`'s knowledge response returns per document, not a column requirement on this table. |

## KnowledgeEmbedding *(new for v2.0)*

Source: PRD §K1, tile 1 query: `COUNT(*) FROM knowledge_embeddings`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | **[INFERRED]** — this table is referenced by the PRD's own K1 query but is not otherwise described anywhere in the PRD text. Treated as given per Constitution I: not renamed, not merged into `KnowledgeDocument`, pending reconciliation against `ai_incident_response_database_schema.md` (spec.md Assumption 17). |
| `knowledge_document_id` | string → `KnowledgeDocument.id` | **[INFERRED]** — the natural parent relationship (a document is chunked into embeddings), consistent with the v1 prototype's "1,284 knowledge chunks" figure. |
| `document_type` | string | **[INFERRED]** — denormalized copy of the parent document's `type`, needed for K1's `COUNT(DISTINCT document_type)` half of the tile without a join; only used in aggregate, never rendered per-row. |

This is the only entity in this data model with no PRD prose backing beyond the one SQL fragment in
§K1 — every field on it is inferred rather than cited, and is flagged accordingly.

## IncidentEvent

Source: PRD §D6.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `incident_id` | string → `Incident.id` | |
| `event_type` | enum, at least `INCIDENT_CREATED`\|`EMAIL_RECEIVED`\|`INCIDENT_CLASSIFIED`\|`RAG_SEARCH_STARTED`\|`RAG_SEARCH_COMPLETED`\|`SIMILAR_INCIDENT_FOUND`\|`ACTION_RECOMMENDED`\|`DEVELOPER_NOTIFIED`\|`ACTION_APPROVED`\|`ACTION_REJECTED`\|`ACTION_EXECUTED`\|`VALIDATION_FAILED`\|`ESCALATED` | Named across AR-8, TL-2, and the v2 prototype's own timeline mock (the intake/classification/RAG events are new-observed since v1.0, though always implied by §D3's agent list). Full enum **[INFERRED]**. |
| `description` | string | Human-readable (§D6). |
| `created_by` | string | Actor — agent, user, or system (§D6). For user-attributed events this is the FR-119 operator name. |
| `payload` | JSON | Expandable per row (§D6); not fetched until expanded, consistent with P-4's intent even though §D6 doesn't name it as JSONB explicitly. |
| `created_at` | timestamp | Ordering key; cumulative-elapsed-time display (TL-3) is computed from this against the incident's `created_at`. |

## DeveloperFeedback

Source: PRD §N2 (AR-6), §D2, §D7, §FI (feedback impact).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `incident_id` | string → `Incident.id` | |
| `recommended_action_id` | string → `RecommendedAction.id` \| null | Set when feedback originates from a reject (AR-6); null for a standalone §D7 submission. |
| `feedback_type` | enum `APPROVED`\|`REJECTED`\|`CORRECTED` | §D7. |
| `comments` | string | For a rejection, this is where the required reason lives today (see `RecommendedAction.rejection_reason`). |
| `corrected_category` | string \| null | Drives the "AI said X → human corrected to Y" display (§D2) **and** is one half of the feedback-impact accuracy comparison (FR-075) — compared against the matching `AgentRun.output`'s classification for the same incident. |
| `corrected_priority` | enum \| null | Same, for priority. |
| `corrected_resolution` | string \| null | §D7 only. |
| `created_by` | string | FR-119 operator name. |
| `created_at` | timestamp | |

**Feedback-impact aggregate (FR-074–FR-079, new for v2.0):** the widget's accuracy percentage is
*not* a stored field — it is computed from this table joined to `AgentRun.output` per spec.md's
FR-075 (Assumption 14): denominator = incidents with any `DeveloperFeedback` row; numerator = rows
where `feedback_type='APPROVED'`, or `feedback_type='CORRECTED'` where the correction happens to
equal the original classification. This derivation lives in `domain/feedbackAccuracy.ts`
(component-inventory.md), never inside a component, per Constitution III. The **personal** figures
are all-time; the **team** total is fixed to the current calendar quarter (Assumption 15) — neither
is parameterized by the dashboard's time-range control, unlike every other aggregate in this model.

## Cross-cutting notes

- **Automation classification** (the incident-table icon: 🤖/👤/⚠️/—) is not a stored field — it is
  derived per incident from its `RecommendedAction`/`ExecutedAction` rows, using the same predicate
  as the §6.1 automation-rate query. This derivation lives in `domain/automationIcon.ts`, not on this
  model, per Constitution III.
- **Age** (FR-055) is derived from `Incident.created_at` and an injected clock, not stored.
- **The alert strip's two counts** (P1-active, awaiting-approval — FR-008) are derived aggregates
  over `Incident`/`RecommendedAction` respectively, served by their own endpoint
  (`contracts/dashboard-endpoints.md`) specifically so they can be computed and refreshed
  independently of every other aggregate in this model (research.md §12).
- No entity above is created or edited by this feature beyond: `RecommendedAction.status` (approve/
  reject), `ExecutedAction` (created by approval, read-only otherwise), `DeveloperFeedback` (created
  by reject or the §D7 form), and `Incident.{assigned_to, priority, status}` via the FR-061
  incident-update operation once it exists. Everything else is read-only, matching the non-goals
  (Out of Scope section, spec.md).
