# Contracts: Dashboard Aggregates

**Revised for PRD v2.0.** The four endpoints below replace v1.0's `summary`/`funnel`/`breakdowns`/
`executions` split — not a rename, a restructuring around the tab/strip IA. Each is a single request
per Principle XI/P-3 (FR-117) — no panel issues a second call to assemble its own numbers. All are
read-only.

Shared query params (except alert-strip, which takes none — see below): `from`, `to` (ISO 8601,
derived from the active time range per FR-001), `env` (repeated, FR-002), `service` (optional,
FR-003).

---

## `GET /api/dashboard/alert-strip`

**Purpose**: P1-active + awaiting-approval counts only (FR-008). Deliberately its own endpoint —
polled on its own 30s cadence regardless of which tab is active (FR-015), and must never be blocked
behind a heavier aggregate query.

**Consumed by**: `components/layout/AlertStrip`, mounted in the header outside any tab panel
(research.md §12).

**Query params**: none. This endpoint always reflects current state — it does not take `from`/`to`,
matching the strip's own rule of ignoring the time range entirely (FR-014).

**Response**:

```ts
{
  p1Active: number;
  awaitingApproval: number;
  oldestPendingAgeMinutes: number | null;   // null only when awaitingApproval === 0 (FR-012)
  autoExecutedCountInRange: number;          // shown in the calm-state secondary line (FR-012)
}
```

**Errors**: `4xx`/`5xx` → the strip shows its own stale/error state (FR-107) — this MUST NOT block
rendering of any tab, since the strip is the one thing that must stay legible under failure.

**Side effects**: none.

---

## `GET /api/dashboard/now`

**Purpose**: The four Now-tab operational tiles (FR-027). No `from`/`to` — always current, like the
strip (FR-030).

**Consumed by**: `components/kpi/KpiStrip` when rendering inside the Now tab panel.

**Query params**: `env`, `service`.

**Response**:

```ts
{
  openIncidents: { value: number; deltaVsPrevious: number };
  escalated: { value: number; deltaVsPrevious: number };
  unassigned: { value: number; deltaVsPrevious: number };
  oldestOpen: { ageMinutes: number | null; priority: "P1" | "P2" | "P3" | "P4" | null }; // null when no open incidents exist
}
```

Neither `p1Active` nor `awaitingApproval` appears here — both are exclusively the alert strip's
(FR-027, spec.md US1 scenario 11). A component consuming this response MUST NOT reconstruct either
count from it as a substitute tile.

**Errors/Side effects**: Now-tiles-only failure per Principle VIII; read-only.

---

## `GET /api/dashboard/performance`

**Purpose**: The three Performance-tab automation tiles (FR-080), the funnel (FR-083), the
automation-rate split (FR-089), and execution outcomes (FR-090). Grouped together because the PRD
nests §6.1 and the outcomes donut directly under the Performance tab as one reading — these are the
"is the AI working" numbers as a set, not independently fetched sub-pages.

**Consumed by**: `components/kpi/KpiStrip` (Performance variant), `components/charts/
AutomationFunnel`, `components/charts/ExecutionOutcomeDonut`.

**Query params**: `from`, `to`, `env`, `service`.

**Response**:

```ts
{
  tiles: {
    automationRatePercent: { value: number; deltaVsPrevious: number };
    medianTimeToResolveMinutes: { value: number | null; averageMinutes: number; deltaVsPrevious: number | null };
    knownIncidentHitRate: { value: number; deltaVsPrevious: number };
  };
  funnel: {
    stages: Array<{
      key: "received" | "classified" | "ragMatched" | "recommended" | "approvedOrAutoRun" | "executedSuccessfully" | "validatedResolved";
      label: string;
      count: number;
      dropCount: number | null;   // null only for "received" (FR-088)
    }>;
    automationRate: {
      fullyAutomatedPercent: number;   // resolved, successful execution, never required approval
      humanAssistedPercent: number;    // resolved, AI proposed, human approved, execution succeeded
    };
  };
  outcomes: {
    counts: { success: number; failed: number; rolledBack: number; running: number }; // EO-1: rolledBack always separate
    successRatePercent: number;
    medianDurationMinutes: number | null;
    byActionType: Array<{ actionType: "SQL" | "LAMBDA" | "API" | "GITHUB_PR" | "KUBERNETES"; success: number; failed: number; rolledBack: number; running: number }>;
    recentFailures: Array<{ executedActionId: string; incidentId: string; actionType: string; truncatedErrorMessage: string }>;
  };
}
```

**`validatedResolved` note**: per data-model.md's `ExecutedAction.validation_status` gap, this
stage's `count`/`dropCount` are `null` until the upstream validation record exists (Assumption 5).
The UI renders this stage as explicitly unavailable, not zero.

**FR-089 note**: `fullyAutomatedPercent`/`humanAssistedPercent` MUST always render as two adjacent
numbers — never summed or merged into `tiles.automationRatePercent`, which is the single blended
number the tile needs; both are served by the same underlying computation, just projected
differently for the tile versus the funnel section.

**Cross-tab jump payload**: the largest-drop annotation (FR-084) and the drop-set click target
(FR-085/FR-086) are computed client-side in `domain/funnel.ts` from `dropCount` — the server
supplies counts, not narrative text or a pre-built filter.

**Errors/Side effects**: each of the three sections (tiles/funnel/outcomes) fails and retries
independently within this one response's consuming components (Principle VIII still applies at the
component level even though one request serves all three — a malformed `outcomes` block must not
blank the funnel).

---

## `GET /api/dashboard/breakdowns`

**Purpose**: Volume trend and the priority/category/service breakdowns (FR-095–FR-098). Kept as its
own endpoint (unlike the merge above) because the PRD's own build order (§12) demotes this content
to the lowest priority (User Story 5) — it does not need to load with the funnel/outcomes tiles that
matter more, and splitting it keeps that lower-priority content from slowing down a higher-priority
one.

**Consumed by**: `components/charts/VolumeChart`, `components/charts/BreakdownBars`.

**Query params**: `from`, `to`, `env`.

**Response**:

```ts
{
  volume: Array<{ bucketStart: string; known: number; unknown: number; medianResolutionMinutes: number | null }>;
  byPriority: Array<{ priority: "P1" | "P2" | "P3" | "P4"; count: number }>;
  byCategory: Array<{ category: string; count: number }>;   // server pre-sorts descending, top 6 + "Other"
  byService: Array<{ serviceId: string; serviceName: string; count: number; knownRate: number }>; // top 5
}
```

**Errors/Side effects**: as above; each series' owning panel fails independently.

---

## `GET /api/dashboard/knowledge`

**Purpose**: All three Knowledge-tab panels (FR-099–FR-104): the three tiles, coverage gaps, and
documents driving resolutions. The documentation-candidates list (K4) is served by
`GET /api/incidents` with a dedicated filter (see `contracts/incidents-endpoints.md`), since it is
fundamentally an incident list, not a knowledge aggregate — reusing the incident-list contract
avoids a second, parallel definition of "what an incident row looks like."

**Consumed by**: `components/kpi/KpiStrip` (Knowledge variant), `components/charts/
CoverageGapsChart`, `components/charts/DocumentsDrivingResolutions`.

**Query params**: `from`, `to`.

**Response**:

```ts
{
  tiles: {
    knowledgeDocumentCount: number;
    distinctDocumentTypeCount: number;
    servicesWithRunbookCount: number;    // of total service count
    totalServiceCount: number;
    undocumentedResolutionCount: number;
  };
  coverageGaps: Array<{ serviceId: string; serviceName: string; knownRate: number }>; // server pre-sorts ascending (FR-100); client renders the caption naming the worst one (FR-101)
  documentsDrivingResolutions: Array<{ documentId: string; documentType: string; title: string; resolutionCount: number }>; // server pre-sorts descending (FR-102)
}
```

**Errors/Side effects**: as above; Knowledge-tile/coverage-gap/documents-panel each fail
independently.
