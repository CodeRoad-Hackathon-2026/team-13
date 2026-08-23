import { useQuery } from "@tanstack/react-query";
import { apiRequest, buildQuery } from "../client";
import type { Priority } from "../types";

export interface NowTilesData {
  openIncidents: { value: number; deltaVsPrevious: number };
  escalated: { value: number; deltaVsPrevious: number };
  unassigned: { value: number; deltaVsPrevious: number };
  oldestOpen: { ageMinutes: number | null; priority: Priority | null };
}

export interface NowTilesParams {
  environment?: string[];
  service?: string | null;
}

// FR-027/FR-030: the four Now-tab operational tiles. No from/to — always current.
export function fetchNowTiles(params: NowTilesParams = {}): Promise<NowTilesData> {
  const query = buildQuery({
    env: params.environment?.join(","),
    service: params.service ?? undefined,
  });
  return apiRequest<NowTilesData>(`/api/dashboard/now${query}`);
}

export function useNowTiles(params: NowTilesParams = {}) {
  return useQuery({
    queryKey: ["dashboard", "now", params],
    queryFn: () => fetchNowTiles(params),
  });
}
