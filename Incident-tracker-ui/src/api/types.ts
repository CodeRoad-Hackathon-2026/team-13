// Mirrors specs/001-incident-response-dashboard/data-model.md. Every field cites a PRD passage
// there; fields flagged [INFERRED]/[GAP] in that doc are annotated the same way here.

export type Priority = "P1" | "P2" | "P3" | "P4";
export type Environment = "Production" | "Staging" | "Development";

// The union's members as a value, so a form can render them and a filter can
// list them without a second hand-maintained copy. It was written out three
// times before this: here as a type, in DashboardHeader as a local array, and as
// the default in useUrlState. The backend's own list comes from the map that
// normalises an inbound incident, so these are the only three an incident can
// ever carry.
export const ENVIRONMENTS: readonly Environment[] = ["Production", "Staging", "Development"];
export type Source = "Email" | "Slack" | "PagerDuty" | "API" | "Manual";

// [INFERRED beyond these six — data-model.md's Incident.status note]
export type IncidentStatus =
  | "OPEN"
  | "ESCALATED"
  | "INVESTIGATING"
  | "MITIGATED"
  | "RESOLVED"
  | "CLOSED";

export type AutomationStatus = "fully_automated" | "human_approved" | "needs_human" | "none";

export interface Incident {
  id: string; // internal identifier — addressing key (FR-059)
  externalId: string;
  title: string;
  description: string;
  status: IncidentStatus;
  priority: Priority;
  environment: Environment;
  category: string; // open vocabulary, no fixed enum
  serviceId: string;
  assignedTo: string | null;
  confidenceScore: number | null;
  isKnownIncident: boolean;
  source: Source;
  createdAt: string;
  resolvedAt: string | null;
  firstResponseAt: string | null; // [GAP — PRD §10 item 1] not displayed by any FR
}

export interface Service {
  id: string;
  name: string;
  // criticality — [GAP — PRD §10 item 5] not in scope
}

export type ActionType = "SQL" | "LAMBDA" | "API" | "GITHUB_PR" | "KUBERNETES";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type RecommendedActionStatus = "PROPOSED" | "APPROVED" | "REJECTED";

export interface RecommendedAction {
  id: string;
  incidentId: string;
  actionType: ActionType;
  description: string;
  riskLevel: RiskLevel;
  confidenceScore: number;
  approvalRequired: boolean;
  status: RecommendedActionStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  // rejectionReason — [GAP — PRD §10 item 2 / spec.md Assumption 6]. Carried on
  // DeveloperFeedback.comments today; exposed here for the UI-side type only.
  rejectionReason?: string;
}

export type ExecutedActionStatus = "RUNNING" | "SUCCESS" | "FAILED" | "ROLLED_BACK";

export interface ExecutedAction {
  id: string;
  recommendedActionId: string;
  status: ExecutedActionStatus;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  // validationStatus — [GAP — PRD §10 item 4]. No validation record exists; the funnel's
  // "validatedResolved" stage renders as explicitly unavailable (spec.md Assumption 5).
}

export type AgentRunStatus = "SUCCESS" | "FAILED"; // [INFERRED beyond these two]

export interface AgentRun {
  id: string;
  incidentId: string;
  agentName: string;
  agentVersion: string;
  status: AgentRunStatus;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null; // [GAP — PRD §10 item 1]; duration derives from timestamps when null
  confidenceScore: number | null;
  errorMessage: string | null;
}

export interface SimilarityMatch {
  id: string;
  incidentId: string;
  knowledgeDocumentId: string;
  score: number;
}

// [INFERRED beyond these five — data-model.md's KnowledgeDocument.type note]
export type DocumentType =
  | "INCIDENT"
  | "RUNBOOK"
  | "POSTMORTEM"
  | "GITHUB_ISSUE"
  | "DOCUMENTATION"
  | "TROUBLESHOOTING_GUIDE";

export interface KnowledgeDocument {
  id: string;
  title: string;
  type: DocumentType;
  summary: string;
  sourceUrl: string;
  resolutionCount: number; // computed, not stored (K3) — see data-model.md
}

// [INFERRED — new for v2.0, no PRD prose beyond the K1 SQL fragment]
export interface KnowledgeEmbedding {
  id: string;
  knowledgeDocumentId: string;
  documentType: DocumentType;
}

// [INFERRED beyond these — data-model.md's IncidentEvent.event_type note]
export type EventType =
  | "INCIDENT_CREATED"
  | "EMAIL_RECEIVED"
  | "INCIDENT_CLASSIFIED"
  | "RAG_SEARCH_STARTED"
  | "RAG_SEARCH_COMPLETED"
  | "SIMILAR_INCIDENT_FOUND"
  | "ACTION_RECOMMENDED"
  | "DEVELOPER_NOTIFIED"
  | "ACTION_APPROVED"
  | "ACTION_REJECTED"
  | "ACTION_EXECUTED"
  | "VALIDATION_FAILED"
  | "ESCALATED";

export interface IncidentEvent {
  id: string;
  incidentId: string;
  eventType: EventType;
  description: string;
  createdBy: string; // agent / user / system — user-attributed events carry the FR-119 operator name
  createdAt: string;
}

export type FeedbackType = "APPROVED" | "REJECTED" | "CORRECTED";

export interface DeveloperFeedback {
  id: string;
  incidentId: string;
  recommendedActionId: string | null;
  feedbackType: FeedbackType;
  comments: string;
  correctedCategory: string | null;
  correctedPriority: Priority | null;
  correctedResolution: string | null;
  createdBy: string;
  createdAt: string;
}
