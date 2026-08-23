import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "../client";

export interface ApproveActionRequest {
  actor: string;
  confirmedHighRisk?: true;
}

export interface ApproveActionResponse {
  executedActionId: string;
  status: "RUNNING";
}

// FR-037/FR-040/FR-043: confirmedHighRisk is required and true iff the action is HIGH risk — the
// server independently enforces this with a 400; ApproveConfirmModal is the fast client-side path.
export function approveAction(actionId: string, request: ApproveActionRequest): Promise<ApproveActionResponse> {
  return apiRequest<ApproveActionResponse>(`/api/actions/${actionId}/approve`, { method: "POST", body: request });
}

// FR-042/FR-044: the mutation key is scoped by actionId, so this card's in-flight mutation state
// can never be touched by approving or rejecting a different card. Deliberately does NOT
// invalidate the pending list on success — an approved card must keep showing itself resolve to
// Executing → Success/Failure in place (AC2/FR-040), not disappear from a list refetch the moment
// it's no longer PROPOSED server-side.
export function useApproveAction(actionId: string) {
  return useMutation({
    mutationKey: ["actions", actionId, "approve"],
    mutationFn: (request: ApproveActionRequest) => approveAction(actionId, request),
  });
}
