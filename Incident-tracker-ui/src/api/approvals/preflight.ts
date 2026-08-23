import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";

export type PreflightStatus = "pass" | "warn" | "fail";

// blocked — at least one check would stop this before anything happened.
// dry_run — it would run, but stop short of the irreversible part.
// will_run — it would run, for real.
export type PreflightVerdict = "blocked" | "dry_run" | "will_run";

export interface PreflightCheck {
  key: string;
  label: string;
  status: PreflightStatus;
  detail: string;
}

export interface PreflightData {
  verdict: PreflightVerdict;
  summary: string;
  checks: PreflightCheck[];
}

export function fetchPreflight(actionId: string): Promise<PreflightData> {
  return apiRequest<PreflightData>(`/api/actions/${actionId}/preflight`);
}

/**
 * What the execution path would decide, asked before the approval instead of
 * after. Lazily fetched like the parameters panel (P-4): the request goes out
 * when an operator opens the panel, not when the card renders.
 *
 * Not cached across the session — the answer depends on server configuration and
 * on whether someone else has approved this in the meantime, and a stale "this
 * would run" is the one wrong answer that matters here.
 */
export function usePreflight(actionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["actions", actionId, "preflight"],
    queryFn: () => fetchPreflight(actionId),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}
