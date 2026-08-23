import { useQuery } from "@tanstack/react-query";
import { apiRequest, buildQuery } from "../client";
import type { Priority } from "../types";

export interface VolumeBucket {
  bucketStart: string;
  known: number;
  unknown: number;
  medianResolutionMinutes: number | null;
}

export interface BreakdownsData {
  volume: VolumeBucket[];
  byPriority: Array<{ priority: Priority; count: number }>;
  byCategory: Array<{ category: string; count: number }>; // server pre-sorts descending, top 6 + "Other"
  byService: Array<{ serviceId: string; serviceName: string; count: number; knownRate: number }>; // top 5
}

export interface BreakdownsParams {
  from?: string;
  to?: string;
  environment?: string[];
}

// FR-095-098/P4/P5: volume trend and the three breakdown charts. Kept as its own endpoint,
// separate from Performance's tiles/funnel/outcomes — the PRD's own build order (§12) demotes
// this content to the lowest priority, so it shouldn't slow down what loads before it.
export function fetchBreakdowns(params: BreakdownsParams = {}): Promise<BreakdownsData> {
  const query = buildQuery({ from: params.from, to: params.to, env: params.environment?.join(",") });
  return apiRequest<BreakdownsData>(`/api/dashboard/breakdowns${query}`);
}

// FR-108: volume/breakdowns live on the Performance tab, so they follow the same 5-minute cadence
// as usePerformance rather than the alert strip's 30s.
export function useBreakdowns(params: BreakdownsParams = {}) {
  return useQuery({
    queryKey: ["dashboard", "breakdowns", params],
    queryFn: () => fetchBreakdowns(params),
    refetchInterval: 300_000,
  });
}
