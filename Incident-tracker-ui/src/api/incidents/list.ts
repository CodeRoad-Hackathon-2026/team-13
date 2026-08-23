import { useQuery } from "@tanstack/react-query";
import { apiRequest, buildQuery } from "../client";
import type { AutomationStatus, Environment, IncidentStatus, Priority, Source } from "../types";

export interface IncidentRow {
  id: string;
  externalId: string;
  priority: Priority;
  status: IncidentStatus;
  title: string;
  serviceName: string;
  environment: Environment;
  category: string;
  isKnownIncident: boolean;
  bestMatchScore: number | null;
  confidenceScore: number | null;
  createdAt: string;
  assignedTo: string | null;
  automationStatus: AutomationStatus;
  source: Source;
  // Only populated when `candidate=true` was requested (K4).
  candidateReason: string | null;
  recurrenceCount: number | null;
}

export interface IncidentListResponse {
  rows: IncidentRow[];
  totalCount: number;
  page: number;
}

export interface IncidentListParams {
  status?: string;
  priority?: Priority;
  service?: string | null;
  environment?: string[];
  q?: string;
  page?: number;
  sort?: "priority" | "age" | "confidence";
  includeResolved?: boolean;
  // At most one of the drill-down params below is ever sent (FR-025).
  kpiTile?: string;
  funnelDropAt?: string;
  funnelStage?: string;
  breakdown?: string;
  candidate?: boolean;
}

// FR-048-057, P-3/P-4: server-side filter/sort/page; never returns JSONB fields.
export function fetchIncidentList(params: IncidentListParams = {}): Promise<IncidentListResponse> {
  const query = buildQuery({
    status: params.status,
    priority: params.priority,
    service: params.service ?? undefined,
    env: params.environment?.join(","),
    q: params.q,
    page: params.page,
    sort: params.sort,
    includeResolved: params.includeResolved,
    kpiTile: params.kpiTile,
    funnelDropAt: params.funnelDropAt,
    funnelStage: params.funnelStage,
    breakdown: params.breakdown,
    candidate: params.candidate,
  });
  return apiRequest<IncidentListResponse>(`/api/incidents${query}`);
}

export function useIncidentList(params: IncidentListParams = {}) {
  return useQuery({
    queryKey: ["incidents", "list", params],
    queryFn: () => fetchIncidentList(params),
  });
}
