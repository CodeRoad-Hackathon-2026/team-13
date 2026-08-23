import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { ExecutedActionStatus } from "../types";
import { pollIntervalMs } from "../../domain/execution";
import type { Clock } from "../../domain/clock";
import { systemClock } from "../../domain/clock";

export interface ExecutionStatus {
  status: ExecutedActionStatus;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// contracts/approvals-endpoints.md: keyed by the RecommendedAction's own id, matching how
// ApprovalCard is keyed (FR-042) — not the ExecutedAction id, which the card never needs to know.
export function fetchExecutionStatus(actionId: string): Promise<ExecutionStatus> {
  return apiRequest<ExecutionStatus>(`/api/actions/${actionId}/execution`);
}

// FR-041/FR-042: cadence switches at the 2-minute bound (domain/execution.ts), keyed by actionId so
// one card's poll can never affect another's; stops polling once the run is no longer RUNNING.
export function useExecutionStatus(actionId: string, enabled: boolean, clock: Clock = systemClock) {
  return useQuery({
    queryKey: ["actions", actionId, "execution"],
    queryFn: () => fetchExecutionStatus(actionId),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.status !== "RUNNING") return false;
      return pollIntervalMs(data.startedAt, clock);
    },
  });
}
