# Architecture

High-level diagrams for the AI Incident Response Orchestrator dashboard. This repo is the
**frontend only** — see `specs/001-incident-response-dashboard/plan.md` for the authoritative
technical plan and `.specify/memory/constitution.md` for the binding rules these diagrams
illustrate. Detail on individual components lives in `component-inventory.md`; API shapes in
`contracts/*.md`.

## 1. System context

The SPA never talks to the database, an LLM, or any remediation target directly — only to the
orchestrator, through same-origin `/api`.

```mermaid
flowchart LR
    operator["On-call engineer / eng manager<br/>(browser)"]

    subgraph runtime["Production runtime (docker, this repo's Dockerfile)"]
        nginx["Nginx<br/>serves the built SPA<br/>proxies /api/*"]
    end

    orchestrator["Orchestrator backend<br/>(separate repo — FastAPI, :8001)"]
    db["Postgres<br/>incidents, recommended_actions, executed_actions,<br/>agent_runs, similarity_matches, incident_events,<br/>developer_feedback, knowledge_embeddings"]
    rag["RAG Core / LLM provider<br/>classification, similarity search,<br/>action recommendation"]
    targets["Remediation targets<br/>SQL / Lambda / API / GitHub PR / Kubernetes"]

    operator -->|HTTPS, one origin| nginx
    nginx -->|"/api/* (proxy_pass)"| orchestrator
    nginx -->|static assets| operator
    orchestrator --> db
    orchestrator -->|holds the only credentials| rag
    orchestrator -->|on operator approval| targets

    note["The browser never sees RAG Core or DB credentials —<br/>the orchestrator is the sole holder (deploy/nginx.conf)"]
    style note fill:#fff,stroke:#999,stroke-dasharray: 3 3
```

## 2. Two ways to run the frontend

The same built artifact runs against either boundary — nothing in application code branches on
which one is active (constitution, Technology Constraints: `api/client.ts` is the only `fetch`).

```mermaid
flowchart TB
    app["React app (src/)"]
    client["api/client.ts<br/>(single fetch wrapper, relative paths)"]
    app --> client

    client -->|"dev default, all tests"| msw["MSW service worker<br/>intercepts in-browser"]
    msw --> fixtures["api/fixtures/seededDataset.ts<br/>+ handlers/*.ts"]

    client -->|"VITE_USE_API=true"| proxy["Vite dev proxy  →  Nginx (prod)"]
    proxy --> backend["Orchestrator backend<br/>(localhost:8001 dev, docker network in prod)"]

    style msw fill:#eef,stroke:#557
    style proxy fill:#efe,stroke:#575
```

- **Fixture mode** (default `npm run dev`, and always in Vitest/Playwright): MSW answers every
  request from the seeded dataset — zero backend setup, deterministic tests.
- **Live mode** (`VITE_USE_API=true npm run dev`, and always in the production image): MSW never
  starts; the Vite proxy (dev) or Nginx `location /api/` (prod) forwards to the real orchestrator.

## 3. Frontend internal layering

Enforced by the constitution: `domain/` has no React or fetch dependency and is unit-testable with
an injected clock; `components/` never computes metrics inline; all server state lives in
TanStack Query, all shareable view state in the URL.

```mermaid
flowchart TB
    subgraph components["src/components/ — presentation only"]
        layout["layout/<br/>DashboardHeader, AlertStrip, TabBar, TabPanel"]
        feature["kpi/ · approvals/ · incidents/ · charts/"]
        shared["shared/<br/>PanelBoundary, StaleBanner, pills, CrossTabFilterChip"]
    end

    subgraph state["src/state/ — cross-cutting, no domain math"]
        url["useUrlState<br/>(filters, active tab, open incident)"]
        qc["queryClient<br/>(TanStack Query — one query per panel)"]
        op["OperatorContext"]
        jump["useCrossTabJump / useFocusTrap"]
    end

    subgraph domain["src/domain/ — pure functions, clock-injected"]
        pure["kpi.ts, funnel.ts, age.ts, filters.ts,<br/>feedbackAccuracy.ts, coverageGaps.ts, rejection.ts, ..."]
    end

    subgraph api["src/api/ — typed HTTP boundary"]
        resource["dashboard/*.ts, incidents/*.ts,<br/>approvals/*.ts, feedback*.ts"]
        client["client.ts (the only fetch)"]
    end

    feature -->|reads/writes| url
    feature -->|useQuery/useMutation| qc
    feature --> shared
    layout --> url
    qc --> resource
    resource --> client
    feature -->|"pure calculations\n(no I/O)"| pure
    feature -->|"approve/reject, drawer,\nfunnel/breakdown clicks"| jump
    jump --> url
```

## 4. Runtime composition (why the strip and tabs behave the way they do)

```mermaid
flowchart TB
    A["App — QueryClientProvider, OperatorProvider"] --> D["Dashboard"]
    D --> H["sticky header block"]
    H --> DH["DashboardHeader<br/>(env + time-range filters)"]
    H --> AS["AlertStrip<br/>own query, own 30s poll —<br/>NEVER inside a TabPanel"]
    H --> TB["TabBar<br/>role=tablist, writes active tab to URL"]

    D --> TPN["TabPanel now<br/>(always mounted, hidden via CSS attr)"]
    D --> TPP["TabPanel performance<br/>(always mounted)"]
    D --> TPK["TabPanel knowledge<br/>(always mounted)"]

    TPN --> KN["KpiStripNow · ApprovalQueue · IncidentTable"]
    TPP --> KP["KpiStripPerformance · AutomationFunnel ·<br/>ExecutionOutcomeDonut · VolumeChart · 3× BreakdownBars"]
    TPK --> KK["KpiStripKnowledge · CoverageGapsChart ·<br/>DocumentsDrivingResolutions · DocumentationCandidates"]

    D --> DR["IncidentDetailDrawer<br/>(?incident=<id> deep link, own query)"]
    D --> CT["CrossTabToast"]
```

Because all three `TabPanel`s stay mounted and the alert strip lives outside every panel, switching
tabs is a pure visibility toggle — no refetch, no skeleton, and Performance/Knowledge keep polling
in the background exactly as if they were visible (FR-019, research.md §11).

## 5. Key cross-cutting flows

**Cross-tab jump** — a funnel stage or breakdown segment click is a navigation, not a filter:

```mermaid
sequenceDiagram
    actor U as Operator
    participant Chart as AutomationFunnel / BreakdownBars<br/>(Performance or Knowledge tab)
    participant Jump as useCrossTabJump
    participant URL as useUrlState
    participant Table as IncidentTable (Now tab)
    participant Toast as CrossTabToast

    U->>Chart: click a stage/segment
    Chart->>Jump: jump(filter, label)
    Jump->>URL: set tab=now, set filter
    URL->>Table: re-render with the new filter applied
    Jump->>Table: scroll into view + flash
    Jump->>Toast: show "Jumped to Now — <label>"
    U->>Table: clears the CrossTabFilterChip
    Table->>URL: remove filter only (tab stays "now")
```

**Approve action (idempotent, sibling-safe)**:

```mermaid
sequenceDiagram
    actor U as Operator
    participant Card as ApprovalCard (key=action.id)
    participant Modal as ApproveConfirmModal
    participant API as api/approvals/approve.ts
    participant Backend as Orchestrator

    U->>Card: click Approve
    Card->>Modal: open confirm (useFocusTrap)
    U->>Modal: confirm
    Modal->>Card: disable button immediately
    Card->>API: POST /api/approvals/:id/approve
    API->>Backend: forward (idempotent — second click can't double-fire)
    Backend-->>API: 200, action -> APPROVED, execution begins
    API-->>Card: invalidate this action's query only
    Note over Card: Sibling ApprovalCards keyed by id — unaffected (FR-042)
```

## Related documents

| Question | Where to look |
|---|---|
| Why these libraries (TanStack Query, hand-rolled tabs, MSW, `sql-formatter`)? | `specs/001-incident-response-dashboard/research.md` |
| Full field-level entity shapes | `specs/001-incident-response-dashboard/data-model.md` |
| Every component, its classification, and its owning FRs | `specs/001-incident-response-dashboard/component-inventory.md` |
| Request/response shape per endpoint | `specs/001-incident-response-dashboard/contracts/*.md` |
| Binding architectural rules (not just decisions) | `.specify/memory/constitution.md` |
