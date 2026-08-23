import { useQuery } from "@tanstack/react-query";
import { apiRequest, buildQuery } from "../client";
import type { ActionType } from "../types";
import type { FunnelStage } from "../../domain/funnel";

export interface PerformanceTiles {
  automationRatePercent: { value: number; deltaVsPrevious: number };
  medianTimeToResolveMinutes: { value: number | null; averageMinutes: number; deltaVsPrevious: number | null };
  knownIncidentHitRate: { value: number; deltaVsPrevious: number };
}

export interface PerformanceFunnel {
  stages: FunnelStage[];
  automationRate: { fullyAutomatedPercent: number; humanAssistedPercent: number };
}

export interface OutcomeCounts {
  success: number;
  failed: number;
  rolledBack: number;
  running: number;
}

export interface PerformanceOutcomes {
  counts: OutcomeCounts;
  successRatePercent: number;
  medianDurationMinutes: number | null;
  // medianDurationMinutes is null while every run of this type is still in flight — there is no
  // settled duration to take a median of, and a zero would read as "instant".
  byActionType: Array<
    { actionType: ActionType; medianDurationMinutes: number | null } & OutcomeCounts
  >;
  recentFailures: Array<{
    executedActionId: string;
    incidentId: string;
    actionType: string;
    truncatedErrorMessage: string;
  }>;
}

export interface PerformanceData {
  tiles: PerformanceTiles;
  funnel: PerformanceFunnel;
  outcomes: PerformanceOutcomes;
}

export interface PerformanceParams {
  from?: string;
  to?: string;
  environment?: string[];
  service?: string | null;
}

// FR-080/FR-083/FR-089/FR-090: one request serves the three Performance tiles, the funnel, and
// execution outcomes together (contracts/dashboard-endpoints.md — these are read as one set, not
// independently fetched sub-pages). Each consuming component still fails/retries independently
// (Principle VIII) via its own PanelBoundary around this shared query's data.
export function fetchPerformance(params: PerformanceParams = {}): Promise<PerformanceData> {
  const query = buildQuery({
    from: params.from,
    to: params.to,
    env: params.environment?.join(","),
    service: params.service ?? undefined,
  });
  return apiRequest<PerformanceData>(`/api/dashboard/performance${query}`);
}

// FR-108: refreshes on filter change (via queryKey) and every 5 minutes regardless — Performance
// is one of the two tabs polled on a slower cadence than the alert strip's 30s (X-2).
export function usePerformance(params: PerformanceParams = {}) {
  return useQuery({
    queryKey: ["dashboard", "performance", params],
    queryFn: () => fetchPerformance(params),
    refetchInterval: 300_000,
  });
}
