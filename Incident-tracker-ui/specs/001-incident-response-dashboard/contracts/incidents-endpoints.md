# Contracts: Incidents

**Revised for PRD v2.0.** FR numbers match spec.md's post-re-spec numbering.

---

## `GET /api/incidents`

**Purpose**: Paginated table rows (FR-048), server-side filtered/sorted/paginated (FR-053, P-3).
Rendered exclusively on the Now tab (FR-057) — a click anywhere else that needs this list triggers
the cross-tab jump (FR-021) rather than rendering a second table.

**Consumed by**: `components/incidents/IncidentTable`; also reused, with the `candidate` filter
below, by the Knowledge tab's documentation-candidates panel (K4) rather than that panel defining
its own row shape.

**Query params**: `status`, `priority`, `service`, `env`, `q` (free-text, FR-051 — matches `title`,
`description`, `external_id`), `page` (25/page, FR-053), `sort` (`priority`\|`age`\|`confidence`,
FR-050), `includeResolved` (boolean, FR-052), plus one of the drill-down params below (FR-025 — at
most one is ever sent, enforced client-side before the request is built).

**Drill-down params** (mutually exclusive):

- `kpiTile=openIncidents|escalated|unassigned|oldestOpen` (Now-tab tiles, FR-028) or
  `kpiTile=automationRate|medianResolve|knownHitRate` (Performance tiles, FR-082 — cross-tab)
- `funnelDropAt=classified|ragMatched|recommended|approvedOrAutoRun|executedSuccessfully|validatedResolved`
  (FR-085 — the *drop-set* into this stage, cross-tab) or `funnelStage=received` (FR-088 — all
  incidents in range, cross-tab)
- `breakdown=priority:P1|category:Database|service:<serviceId>` (FR-098 — cross-tab)
- `candidate=true` (K4 — resolved incidents with no RAG match, used by the Knowledge tab; **same-tab**,
  not a cross-tab jump, since K4 already lives on a row-click-opens-drawer list, not a jump target)

Every param above except `candidate=true` is a **cross-tab** drill-down per FR-021–FR-026: the
request is only ever issued after the client has already switched to Now, flashed the table, shown
the distinctly-styled chip, and emitted the toast — this contract does not distinguish a same-tab
from a cross-tab request at the HTTP level, that distinction is entirely a client-side sequencing
concern (component-inventory.md's `CrossTabFilterChip`/`CrossTabToast`).

**Response**:

```ts
{
  rows: Array<{
    id: string;                 // internal id — row click addresses the drawer by this (FR-059)
    externalId: string;
    priority: "P1" | "P2" | "P3" | "P4";
    status: string;
    title: string;
    serviceName: string;
    environment: "Production" | "Staging" | "Development";
    category: string;
    isKnownIncident: boolean;
    bestMatchScore: number | null;   // paired with isKnownIncident
    confidenceScore: number | null;
    createdAt: string;               // age computed client-side from this + injected clock
    assignedTo: string | null;
    automationStatus: "fully_automated" | "human_approved" | "needs_human" | "none"; // derived server- or client-side from RecommendedAction/ExecutedAction rows; see data-model.md Cross-cutting notes
    source: "Email" | "Slack" | "PagerDuty" | "API" | "Manual";
    candidateReason: string | null;   // only populated when candidate=true — e.g. "resolved manually in 2h 41m · no match found"; recurrence count folded into this string per K4
    recurrenceCount: number | null;   // only populated when candidate=true and > 1 (FR-103)
  }>;
  totalCount: number;    // must equal the number the triggering tile/stage/segment displayed (SC-005)
  page: number;
}
```

**No JSONB fields anywhere in this response** (P-4) — `parameters`, `input`, `output`,
`execution_logs`, `response_payload` never appear here even nested.

**Empty responses**: `rows: []` with `totalCount: 0` is ambiguous between "no data" and
"no matches" — the client disambiguates using whether any filter/drill-down/search is active
(FR-105), never from the response shape alone.

**Errors/Side effects**: table-only failure (Principle VIII); read-only.

---

## `GET /api/incidents/:id`

**Purpose**: Full detail — events, agent_runs, matches, actions, feedback (FR-060–FR-072). `:id` is
the **internal** identifier (FR-059).

**Consumed by**: `components/incidents/IncidentDetailDrawer` and its child sections.

**Response** (top-level fields per FR-060; nested arrays per FR-064/FR-066/FR-067/FR-069 — none
include their lazy JSONB, see below):

```ts
{
  incident: { id, externalId, title, status, priority, serviceName, environment, assignedTo, createdAt, resolvedAt, source };
  aiClassification: { category: string; priority: string; confidenceScore: number | null };
  correction: { correctedCategory: string | null; correctedPriority: string | null } | null; // FR-063 side-by-side display
  agentRuns: Array<{ id, agentName, agentVersion, status, startedAt, finishedAt, latencyMs: number | null, confidenceScore: number | null, hasError: boolean }>;
  similarityMatches: Array<{ id, documentType, title, score, summarySnippet, sourceUrl }>; // capped at 5 server-side; "show all" (FR-066) issues a second call, see below
  actions: Array<{
    id, actionType, description, riskLevel, confidenceScore, status, approvedBy, approvedAt,
    execution: { id, status, startedAt, finishedAt, errorMessage } | null;
  }>;
  events: Array<{ id, eventType, description, createdBy, createdAt, isAgentEvent: boolean, isFailureEvent: boolean }>; // TL-1/TL-2 flags precomputed so the client doesn't re-derive event-type taxonomy
  feedback: Array<{ id, feedbackType, comments, correctedCategory, correctedPriority, correctedResolution, createdBy, createdAt }>;
}
```

**404 (incident not found)**: renders the "could not be loaded" panel-scoped error (spec.md Edge
Cases: deep link to a nonexistent incident) — never propagates to blank the dashboard behind it.

**An incident outside the active filters**: the drawer still opens and this endpoint still returns
200; filters govern the table, not the drawer (spec.md Edge Cases).

---

## `GET /api/incidents/:id/agent-runs/:runId/io`

**Purpose**: Lazy fetch of one agent run's `input`/`output` JSONB, on expand only (P-4, FR-064).

**Response**: `{ input: unknown; output: unknown }`.

---

## `GET /api/actions/:id/parameters`

**Purpose**: Lazy fetch of one recommended action's `parameters` JSONB, on expand only (P-4, AR-3).

**Response**: `{ parameters: unknown }` — for `action_type = 'SQL'`, `parameters.statement` is what
`sql-formatter` renders (research.md §8); the client never trusts a pre-formatted string from the
server, only the raw statement text.

---

## `GET /api/executions/:id/detail`

**Purpose**: Lazy fetch of one execution's `response_payload`/`execution_logs`, on expand only
(P-4, §D5).

**Response**: `{ responsePayload: unknown; executionLogs: string }`.

---

## `GET /api/incidents/:id/similarity-matches`

**Purpose**: "Show all" beyond the capped 5 (FR-066).

**Response**: `{ matches: SimilarityMatch[] }` (same shape as the capped array above, uncapped).

---

## `GET /api/incidents/:id/events?agentOnly=`

**Purpose**: TL-1's "agent events only" toggle. Implemented as a query param on a re-fetch rather
than a client-side filter, keeping the event list consistent with P-3 (one request per view, no
client-side re-aggregation of a large payload) — this is a deliberate deviation from "server returns
everything, client filters" precisely because event volume is unbounded per incident.

**Response**: same `events` shape as `GET /api/incidents/:id`.

---

## `GET /api/feedback/impact?user&from&to`

**Purpose**: The feedback-impact widget's three numbers (FR-074–FR-076). Documented here rather than
in `contracts/feedback-endpoint.md` because it is a *read*, consumed alongside the rest of the
drawer's read-only sections, while that file covers the feedback *write*.

**Consumed by**: `components/incidents/FeedbackImpactWidget`.

**Query params**: `user` (the operator name, for the personal figures). **No `from`/`to`** despite
the signature above suggesting otherwise — see Assumption 15: personal figures are all-time, the
team figure is fixed to the current calendar quarter, and neither respects the dashboard's
time-range control. The endpoint takes no window params at all; any `from`/`to` a caller passes MUST
be ignored server-side, not silently applied.

**Response**:

```ts
{
  personal: { accuracyPercent: number; previousAccuracyPercent: number; correctionCount: number; lastCorrectionAt: string | null };
  team: { correctionCount: number; engineerCount: number; quarterLabel: string };
  suppressed: boolean;   // true when team.correctionCount < 10 (FR-077); when true, the client renders nothing rather than a caveated widget
}
```

**FR-078 note**: this response never includes an attribution for a decline — the client's copy is
static ("attribute to the model or the period"), not server-driven, so there is no `declineReason`
field to omit or misuse.

**Errors/Side effects**: widget-only failure; read-only.

---

## `PATCH /api/incidents/:id` — *dependency, not yet defined by the PRD*

**Status**: **Not implemented upstream.** This contract exists so FR-061 has a target to build
against once the PRD's API surface is extended; until then, `components/incidents/
IncidentHeaderActions` renders all four controls disabled with this reason shown, per FR-062. Do not
implement the calling code as "TODO enable later" — implement the disabled state as the real,
tested behavior for launch.

**Purpose**: Single operation backing all four PRD §D1 controls (assign-to-me, change-priority,
escalate, mark-resolved) — one contract instead of four, per the spec's v1.0 clarification session.

**Proposed request**:

```ts
{
  assignedTo?: string;       // "assign to me" sends the operator name (FR-119)
  priority?: "P1" | "P2" | "P3" | "P4";
  status?: "ESCALATED" | "RESOLVED";
  actor: string;             // FR-061, FR-119 — always sent, whichever field changed
}
```

**Proposed response**: the updated `incident` object (same shape as in `GET /api/incidents/:id`),
plus the corresponding `IncidentEvent` the write must emit (mirroring AR-8's event-emission pattern
for approve/reject).

**Errors**: `409` if the incident's `status`/`priority` changed since the drawer last read it —
client shows the same "someone else changed this" reconciliation behavior as a contested approval
(spec.md Edge Cases).
