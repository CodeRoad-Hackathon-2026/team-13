import { useQuery } from "@tanstack/react-query";
import { apiRequest, buildQuery } from "../client";
import type {
  ActionType,
  DocumentType,
  Environment,
  EventType,
  ExecutedActionStatus,
  FeedbackType,
  IncidentStatus,
  Priority,
  RecommendedActionStatus,
  RiskLevel,
  Source,
} from "../types";

export interface IncidentDetail {
  incident: {
    id: string;
    externalId: string;
    title: string;
    status: IncidentStatus;
    priority: Priority;
    serviceName: string;
    environment: Environment;
    assignedTo: string | null;
    createdAt: string;
    resolvedAt: string | null;
    source: Source;
  };
  aiClassification: { category: string; priority: Priority; confidenceScore: number | null };
  correction: { correctedCategory: string | null; correctedPriority: Priority | null } | null;
  agentRuns: Array<{
    id: string;
    agentName: string;
    agentVersion: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    latencyMs: number | null;
    confidenceScore: number | null;
    hasError: boolean;
  }>;
  similarityMatches: Array<{
    id: string;
    documentType: DocumentType;
    title: string;
    score: number;
    summarySnippet: string;
    sourceUrl: string;
  }>;
  actions: Array<{
    id: string;
    actionType: ActionType;
    description: string;
    riskLevel: RiskLevel;
    confidenceScore: number;
    status: RecommendedActionStatus;
    approvedBy: string | null;
    approvedAt: string | null;
    execution: { id: string; status: ExecutedActionStatus; startedAt: string; finishedAt: string | null; errorMessage: string | null } | null;
  }>;
  events: Array<{
    id: string;
    eventType: EventType;
    description: string;
    createdBy: string;
    createdAt: string;
    isAgentEvent: boolean;
    isFailureEvent: boolean;
  }>;
  feedback: Array<{
    id: string;
    feedbackType: FeedbackType;
    comments: string;
    correctedCategory: string | null;
    correctedPriority: Priority | null;
    correctedResolution: string | null;
    createdBy: string;
    createdAt: string;
  }>;
}

// FR-059: :id is always the internal identifier.
export function fetchIncidentDetail(id: string): Promise<IncidentDetail> {
  return apiRequest<IncidentDetail>(`/api/incidents/${id}`);
}

export function useIncidentDetail(id: string | null) {
  return useQuery({
    queryKey: ["incidents", "detail", id],
    queryFn: () => fetchIncidentDetail(id as string),
    enabled: id !== null,
  });
}

// P-4: every one of these is fetched only when the caller expands that section.
export function fetchAgentRunIO(
  incidentId: string,
  runId: string,
): Promise<{ input: unknown; output: unknown }> {
  return apiRequest(`/api/incidents/${incidentId}/agent-runs/${runId}/io`);
}

export function fetchActionParameters(actionId: string): Promise<{ parameters: unknown }> {
  return apiRequest(`/api/actions/${actionId}/parameters`);
}

export function fetchExecutionDetail(
  executionId: string,
): Promise<{ responsePayload: unknown; executionLogs: string }> {
  return apiRequest(`/api/executions/${executionId}/detail`);
}

export function fetchSimilarityMatches(
  incidentId: string,
): Promise<{ matches: IncidentDetail["similarityMatches"] }> {
  return apiRequest(`/api/incidents/${incidentId}/similarity-matches`);
}

// TL-1: server-side agentOnly re-fetch, not a client-side filter of a large payload.
export function fetchIncidentEvents(
  incidentId: string,
  agentOnly: boolean,
): Promise<{ events: IncidentDetail["events"] }> {
  const query = buildQuery({ agentOnly });
  return apiRequest(`/api/incidents/${incidentId}/events${query}`);
}
