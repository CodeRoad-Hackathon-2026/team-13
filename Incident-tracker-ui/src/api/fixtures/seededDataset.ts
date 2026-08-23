// Seeded demo dataset backing every MSW handler (research.md §7). Numbers for aggregates
// (funnel, breakdowns) are taken directly from the PRD's own worked examples rather than summed
// from the detail rows below — a real seed spans a wider history than the handful of incidents
// kept here for table/drawer testing.
import type {
  Incident,
  Service,
  RecommendedAction,
  ExecutedAction,
  AgentRun,
  KnowledgeDocument,
  KnowledgeEmbedding,
  SimilarityMatch,
  IncidentEvent,
  DeveloperFeedback,
  Priority,
} from "../types";

export const SERVICES: Service[] = [
  { id: "svc-payments-api", name: "payments-api" },
  { id: "svc-checkout-web", name: "checkout-web" },
  { id: "svc-inventory-svc", name: "inventory-svc" },
  { id: "svc-auth-gateway", name: "auth-gateway" },
  { id: "svc-notify-worker", name: "notify-worker" },
  { id: "svc-search-index", name: "search-index" },
];

const svcId = (name: string) => SERVICES.find((s) => s.name === name)!.id;

// Shared by the alert strip and the approvals queue's positive empty state (AR-9) — one number,
// read by both handlers, so the two can never drift apart.
export const AUTO_EXECUTED_COUNT_IN_RANGE = 14;

// Demo-only simulated execution latency — real time, not domain logic (fixture plumbing standing
// in for a backend, not a Constitution III clock-injected module). Every execution "resolves in
// place" a few seconds after approval, shared by the approve and execution-poll handlers so they
// agree on when a run has finished.
export const SIMULATED_EXECUTION_MS = 4000;

const now = Date.parse("2026-08-16T12:00:00Z");
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

export const INCIDENTS: Incident[] = [
  {
    id: "inc-1042",
    externalId: "INC-1042",
    title: "Connection pool exhausted on payments-db",
    description: "PG connection pool saturated, new connections timing out.",
    status: "INVESTIGATING",
    priority: "P1",
    environment: "Production",
    category: "Database",
    serviceId: svcId("payments-api"),
    assignedTo: "a.reyes",
    confidenceScore: 0.91,
    isKnownIncident: true,
    source: "PagerDuty",
    createdAt: minutesAgo(18),
    resolvedAt: null,
    firstResponseAt: null,
  },
  {
    id: "inc-1041",
    externalId: "INC-1041",
    title: "Stale pricing shown after deploy v4.18.2",
    description: "CDN serving stale pricing fragment after a config change.",
    status: "INVESTIGATING",
    priority: "P2",
    environment: "Production",
    category: "Deployment",
    serviceId: svcId("checkout-web"),
    assignedTo: null,
    confidenceScore: 0.86,
    isKnownIncident: true,
    source: "Slack",
    createdAt: minutesAgo(42),
    resolvedAt: null,
    firstResponseAt: null,
  },
  {
    id: "inc-1040",
    externalId: "INC-1040",
    title: "Checkout 5xx rate above 8% in eu-west",
    description: "Elevated 5xx rate on checkout submission in eu-west.",
    status: "ESCALATED",
    priority: "P1",
    environment: "Production",
    category: "API",
    serviceId: svcId("checkout-web"),
    assignedTo: "m.tan",
    confidenceScore: 0.44,
    isKnownIncident: false,
    source: "PagerDuty",
    createdAt: minutesAgo(63),
    resolvedAt: null,
    firstResponseAt: null,
  },
  {
    id: "inc-1039",
    externalId: "INC-1039",
    title: "Inventory sync deadlock on batch job",
    description: "Nightly batch job deadlocking against live sync writes.",
    status: "INVESTIGATING",
    priority: "P2",
    environment: "Production",
    category: "Database",
    serviceId: svcId("inventory-svc"),
    assignedTo: "a.reyes",
    confidenceScore: 0.77,
    isKnownIncident: true,
    source: "API",
    createdAt: minutesAgo(96),
    resolvedAt: null,
    firstResponseAt: null,
  },
  {
    id: "inc-1038",
    externalId: "INC-1038",
    title: "Intermittent 401s on token refresh",
    description: "Refresh-token rows blocking the unique index intermittently.",
    status: "OPEN",
    priority: "P3",
    environment: "Production",
    category: "API",
    serviceId: svcId("auth-gateway"),
    assignedTo: null,
    confidenceScore: 0.62,
    isKnownIncident: true,
    source: "Email",
    createdAt: minutesAgo(151),
    resolvedAt: null,
    firstResponseAt: null,
  },
  {
    id: "inc-1037",
    externalId: "INC-1037",
    title: "Notification queue depth climbing",
    description: "notify-worker queue depth climbing past normal bounds.",
    status: "MITIGATED",
    priority: "P3",
    environment: "Production",
    category: "Infrastructure",
    serviceId: svcId("notify-worker"),
    assignedTo: "j.okafor",
    confidenceScore: 0.9,
    isKnownIncident: true,
    source: "API",
    createdAt: minutesAgo(212),
    resolvedAt: null,
    firstResponseAt: null,
  },
  {
    id: "inc-1036",
    externalId: "INC-1036",
    title: "Search index lag 4m behind primary",
    description: "search-index replication lag above threshold.",
    status: "OPEN",
    priority: "P4",
    environment: "Production",
    category: "Infrastructure",
    serviceId: svcId("search-index"),
    assignedTo: null,
    confidenceScore: 0.83,
    isKnownIncident: true,
    source: "Manual",
    createdAt: minutesAgo(340),
    resolvedAt: null,
    firstResponseAt: null,
  },
  {
    id: "inc-1033",
    externalId: "INC-1033",
    title: "Payment webhook signature failures",
    description: "Webhook signature verification failing for a subset of providers.",
    status: "RESOLVED",
    priority: "P1",
    environment: "Production",
    category: "API",
    serviceId: svcId("payments-api"),
    assignedTo: "a.reyes",
    confidenceScore: 0.51,
    isKnownIncident: false,
    source: "PagerDuty",
    createdAt: minutesAgo(610),
    resolvedAt: minutesAgo(410),
    firstResponseAt: null,
  },
  {
    id: "inc-1031",
    externalId: "INC-1031",
    title: "Cache hit ratio dropped after config change",
    description: "Edge cache hit ratio dropped following a header change.",
    status: "CLOSED",
    priority: "P3",
    environment: "Production",
    category: "Deployment",
    serviceId: svcId("checkout-web"),
    assignedTo: "m.tan",
    confidenceScore: 0.85,
    isKnownIncident: true,
    source: "API",
    createdAt: minutesAgo(880),
    resolvedAt: minutesAgo(820),
    firstResponseAt: null,
  },
];

export const RECOMMENDED_ACTIONS: RecommendedAction[] = [
  {
    id: "act-a1",
    incidentId: "inc-1042",
    actionType: "LAMBDA",
    description: "Restart the payments-db connection pool via remediation Lambda",
    riskLevel: "HIGH",
    confidenceScore: 0.91,
    approvalRequired: true,
    status: "PROPOSED",
    approvedBy: null,
    approvedAt: null,
  },
  {
    id: "act-a2",
    incidentId: "inc-1041",
    actionType: "API",
    description: "Purge CDN cache for tag `pricing` across all edge regions",
    riskLevel: "MEDIUM",
    confidenceScore: 0.86,
    approvalRequired: true,
    status: "PROPOSED",
    approvedBy: null,
    approvedAt: null,
  },
  {
    id: "act-a3",
    incidentId: "inc-1038",
    actionType: "SQL",
    description: "Clear expired refresh-token rows blocking the unique index",
    riskLevel: "LOW",
    confidenceScore: 0.62,
    approvalRequired: true,
    status: "PROPOSED",
    approvedBy: null,
    approvedAt: null,
  },
  {
    id: "act-a4",
    incidentId: "inc-1037",
    actionType: "KUBERNETES",
    description: "Scale notify-worker replicas 4 → 8",
    riskLevel: "LOW",
    confidenceScore: 0.94,
    approvalRequired: false,
    status: "APPROVED",
    approvedBy: "auto",
    approvedAt: minutesAgo(205),
  },
];

export const EXECUTED_ACTIONS: ExecutedAction[] = [
  {
    id: "exec-a4",
    recommendedActionId: "act-a4",
    status: "SUCCESS",
    startedAt: minutesAgo(205),
    finishedAt: minutesAgo(204),
    errorMessage: null,
  },
];

export const AGENT_RUNS: AgentRun[] = [
  {
    id: "run-1",
    incidentId: "inc-1042",
    agentName: "Incident Intake Agent",
    agentVersion: "1.1",
    status: "SUCCESS",
    startedAt: minutesAgo(18),
    finishedAt: minutesAgo(18),
    latencyMs: 820,
    confidenceScore: null,
    errorMessage: null,
  },
  {
    id: "run-2",
    incidentId: "inc-1042",
    agentName: "Classification Agent",
    agentVersion: "2.0",
    status: "SUCCESS",
    startedAt: minutesAgo(18),
    finishedAt: minutesAgo(18),
    latencyMs: 1240,
    confidenceScore: 0.91,
    errorMessage: null,
  },
  {
    id: "run-3",
    incidentId: "inc-1042",
    agentName: "RAG Retrieval Agent",
    agentVersion: "1.4",
    status: "SUCCESS",
    startedAt: minutesAgo(17),
    finishedAt: minutesAgo(16),
    latencyMs: 2110,
    confidenceScore: 0.97,
    errorMessage: null,
  },
  {
    id: "run-4",
    incidentId: "inc-1042",
    agentName: "Decision Agent",
    agentVersion: "1.3",
    status: "SUCCESS",
    startedAt: minutesAgo(16),
    finishedAt: minutesAgo(16),
    latencyMs: 3480,
    confidenceScore: 0.91,
    errorMessage: null,
  },
  {
    id: "run-5",
    incidentId: "inc-1042",
    agentName: "Validation Agent",
    agentVersion: "1.0",
    status: "FAILED",
    startedAt: minutesAgo(16),
    finishedAt: minutesAgo(16),
    latencyMs: 410,
    confidenceScore: null,
    errorMessage: "Precondition failed: no executed_action to validate (action still PROPOSED)",
  },
];

export const KNOWLEDGE_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: "doc-1",
    title: "Runbook #42 — Restarting a saturated PG pool",
    type: "RUNBOOK",
    summary: "Steps to safely drain and restart a PgBouncer pool under load.",
    sourceUrl: "https://runbooks.internal/42",
    resolutionCount: 23,
  },
  {
    id: "doc-2",
    title: "INC-842 — payments-db pool exhausted",
    type: "INCIDENT",
    summary: "Prior incident with the same signature, resolved via pool restart.",
    sourceUrl: "https://incidents.internal/842",
    resolutionCount: 19,
  },
  {
    id: "doc-3",
    title: "Runbook #17 — Purge edge cache by tag",
    type: "RUNBOOK",
    summary: "How to purge CDN cache by tag across all edge regions.",
    sourceUrl: "https://runbooks.internal/17",
    resolutionCount: 14,
  },
  {
    id: "doc-4",
    title: "PM-2026-03 — Pool sizing after traffic spike",
    type: "POSTMORTEM",
    summary: "Postmortem covering pool exhaustion after a traffic spike.",
    sourceUrl: "https://postmortems.internal/2026-03",
    resolutionCount: 9,
  },
  {
    id: "doc-5",
    title: "Disk pressure on inventory nodes",
    type: "TROUBLESHOOTING_GUIDE",
    summary: "Guide for diagnosing disk pressure on inventory-svc nodes.",
    sourceUrl: "https://guides.internal/inventory-disk",
    resolutionCount: 7,
  },
];

export const KNOWLEDGE_EMBEDDINGS: KnowledgeEmbedding[] = KNOWLEDGE_DOCUMENTS.flatMap((doc, i) =>
  Array.from({ length: 8 + i * 3 }, (_, j) => ({
    id: `emb-${doc.id}-${j}`,
    knowledgeDocumentId: doc.id,
    documentType: doc.type,
  })),
);

export const SIMILARITY_MATCHES: SimilarityMatch[] = [
  { id: "match-1", incidentId: "inc-1042", knowledgeDocumentId: "doc-2", score: 0.97 },
  { id: "match-2", incidentId: "inc-1042", knowledgeDocumentId: "doc-1", score: 0.84 },
  { id: "match-3", incidentId: "inc-1042", knowledgeDocumentId: "doc-4", score: 0.71 },
  { id: "match-4", incidentId: "inc-1041", knowledgeDocumentId: "doc-3", score: 0.79 },
];

export const INCIDENT_EVENTS: IncidentEvent[] = [
  {
    id: "evt-1",
    incidentId: "inc-1042",
    eventType: "INCIDENT_CREATED",
    description: "Incident received from PagerDuty alert `PD-88213`",
    createdBy: "system",
    createdAt: minutesAgo(18),
  },
  {
    id: "evt-2",
    incidentId: "inc-1042",
    eventType: "INCIDENT_CLASSIFIED",
    description: "Category: Database · Priority: P1 · confidence 0.91",
    createdBy: "Classification Agent",
    createdAt: minutesAgo(18),
  },
  {
    id: "evt-3",
    incidentId: "inc-1042",
    eventType: "SIMILAR_INCIDENT_FOUND",
    description: "INC-842 matched at 0.97 — marked as known incident",
    createdBy: "RAG Retrieval Agent",
    createdAt: minutesAgo(16),
  },
  {
    id: "evt-4",
    incidentId: "inc-1042",
    eventType: "ACTION_RECOMMENDED",
    description: "LAMBDA remediation-pool-restart proposed · risk HIGH",
    createdBy: "Decision Agent",
    createdAt: minutesAgo(16),
  },
  {
    id: "evt-5",
    incidentId: "inc-1042",
    eventType: "DEVELOPER_NOTIFIED",
    description: "Paged a.reyes — approval required for HIGH risk",
    createdBy: "system",
    createdAt: minutesAgo(16),
  },
];

// ≥10 team-wide rows across 4 engineers this quarter, so the feedback-impact widget renders by
// default (FR-077's 10-correction suppression threshold; spec.md Assumption 15's fixed-quarter
// window). All but two record agreement, giving ~84% accuracy matching the PRD's own mock copy.
const engineers = ["a.reyes", "m.tan", "j.okafor", "s.patel"];
export const DEVELOPER_FEEDBACK: DeveloperFeedback[] = Array.from({ length: 12 }, (_, i) => ({
  id: `fb-${i + 1}`,
  incidentId: INCIDENTS[i % INCIDENTS.length].id,
  recommendedActionId: null,
  feedbackType: i < 10 ? "APPROVED" : "CORRECTED",
  comments: i < 10 ? "Classification looked right." : "Priority should have been higher.",
  correctedCategory: null,
  correctedPriority: i === 11 ? "P1" : null,
  correctedResolution: null,
  createdBy: engineers[i % engineers.length],
  createdAt: minutesAgo(i * 60 * 24 * 6), // spread over the last ~72 days, all within this quarter
}));

export const CANDIDATE_INCIDENT_IDS = ["inc-1040", "inc-1033"] as const;
export const CANDIDATE_RECURRENCE: Record<string, number> = { "inc-1040": 1, "inc-1033": 3 };

export const FUNNEL_STAGES = [
  { key: "received", label: "Incidents received", count: 142, dropCount: null as number | null },
  { key: "classified", label: "Classified by AI", count: 142, dropCount: 0 },
  { key: "ragMatched", label: "RAG match found", count: 98, dropCount: 44 },
  { key: "recommended", label: "Action recommended", count: 87, dropCount: 11 },
  { key: "approvedOrAutoRun", label: "Approved / auto-run", count: 79, dropCount: 8 },
  { key: "executedSuccessfully", label: "Executed successfully", count: 71, dropCount: 8 },
  { key: "validatedResolved", label: "Validated + resolved", count: null as number | null, dropCount: null as number | null },
];

// FR-085/FR-086/§11.4: synthetic drop-set incidents for the automation funnel. FUNNEL_STAGES'
// own dropCounts already represent "a wider history than the handful of incidents kept here for
// table/drawer testing" (this file's own header comment) — so when a funnel stage is clicked, the
// incident table needs exactly this many rows for the reconciliation the PRD's own AC #4 demands,
// which the ~9 detail incidents above are far too few to provide on their own.
const FUNNEL_DROPSET_SIZES: Record<string, number> = {
  classified: 0,
  ragMatched: 44,
  recommended: 11,
  approvedOrAutoRun: 8,
  executedSuccessfully: 8,
};

const FUNNEL_DROPSET_SERVICES = ["payments-api", "checkout-web", "inventory-svc", "auth-gateway", "notify-worker", "search-index"];
const FUNNEL_DROPSET_PRIORITIES: Priority[] = ["P2", "P3", "P3", "P4"];
const FUNNEL_DROPSET_CATEGORIES = ["Database", "API", "Infrastructure", "Deployment"];

function makeFunnelDropsetIncident(stageKey: string, index: number): Incident {
  const service = FUNNEL_DROPSET_SERVICES[index % FUNNEL_DROPSET_SERVICES.length];
  return {
    id: `funnel-${stageKey}-${index}`,
    externalId: `INC-F${stageKey.slice(0, 3).toUpperCase()}${index + 1}`,
    title: `Incident #${index + 1} stalled after ${FUNNEL_STAGES.find((s) => s.key === stageKey)?.label.toLowerCase()}`,
    description: "Part of the funnel's wider history, not one of the incidents kept for detail-drawer testing.",
    status: "INVESTIGATING",
    priority: FUNNEL_DROPSET_PRIORITIES[index % FUNNEL_DROPSET_PRIORITIES.length],
    environment: "Production",
    category: FUNNEL_DROPSET_CATEGORIES[index % FUNNEL_DROPSET_CATEGORIES.length],
    serviceId: svcId(service),
    assignedTo: null,
    confidenceScore: null,
    isKnownIncident: false,
    source: "API",
    createdAt: minutesAgo(60 * 24 * 3 + index),
    resolvedAt: null,
    firstResponseAt: null,
  };
}

export const FUNNEL_DROPSET_INCIDENTS: Record<string, Incident[]> = Object.fromEntries(
  Object.entries(FUNNEL_DROPSET_SIZES).map(([stageKey, size]) => [
    stageKey,
    Array.from({ length: size }, (_, i) => makeFunnelDropsetIncident(stageKey, i)),
  ]),
);

export const BREAKDOWN_BY_PRIORITY = [
  { priority: "P1" as const, count: 11 },
  { priority: "P2" as const, count: 29 },
  { priority: "P3" as const, count: 64 },
  { priority: "P4" as const, count: 38 },
];

export const BREAKDOWN_BY_CATEGORY = [
  { category: "Database", count: 44 },
  { category: "API", count: 38 },
  { category: "Infrastructure", count: 31 },
  { category: "Deployment", count: 19 },
  { category: "Auth", count: 7 },
  { category: "Other", count: 3 },
];

export const BREAKDOWN_BY_SERVICE = [
  { serviceId: svcId("payments-api"), serviceName: "payments-api", count: 34, knownRate: 0.71 },
  { serviceId: svcId("checkout-web"), serviceName: "checkout-web", count: 28, knownRate: 0.82 },
  { serviceId: svcId("inventory-svc"), serviceName: "inventory-svc", count: 26, knownRate: 0.88 },
  { serviceId: svcId("auth-gateway"), serviceName: "auth-gateway", count: 21, knownRate: 0.43 },
  { serviceId: svcId("notify-worker"), serviceName: "notify-worker", count: 17, knownRate: 0.94 },
];

export const VOLUME_SERIES = [
  { bucketStart: "2026-08-06", known: 9, unknown: 5, medianResolutionMinutes: 21 },
  { bucketStart: "2026-08-07", known: 12, unknown: 4, medianResolutionMinutes: 22 },
  { bucketStart: "2026-08-08", known: 7, unknown: 3, medianResolutionMinutes: 20 },
  { bucketStart: "2026-08-09", known: 14, unknown: 6, medianResolutionMinutes: 23 },
  { bucketStart: "2026-08-10", known: 18, unknown: 7, medianResolutionMinutes: 22 },
  { bucketStart: "2026-08-11", known: 21, unknown: 6, medianResolutionMinutes: 21 },
  { bucketStart: "2026-08-12", known: 16, unknown: 4, medianResolutionMinutes: 22 },
];
