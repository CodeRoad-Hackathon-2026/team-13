import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";

export interface AlertStripData {
  p1Active: number;
  awaitingApproval: number;
  oldestPendingAgeMinutes: number | null;
  autoExecutedCountInRange: number;
}

export function fetchAlertStrip(): Promise<AlertStripData> {
  return apiRequest<AlertStripData>("/api/dashboard/alert-strip");
}

// FR-015: polls unconditionally from mount, independent of which tab is active — this query
// lives in AlertStrip, which is mounted outside every TabPanel (research.md §12).
export function useAlertStrip() {
  return useQuery({
    queryKey: ["dashboard", "alert-strip"],
    queryFn: fetchAlertStrip,
    refetchInterval: 30_000,
  });
}
