import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { RejectActionRequest } from "../../domain/rejection";

export interface RejectActionResponse {
  status: "REJECTED";
  approvedBy: string;
  approvedAt: string;
}

// FR-038/FR-039/AR-6: server refuses an empty reason with 400 — the authoritative guard, not just
// RejectForm's client-side one (domain/rejection.ts's isValidRejection).
export function rejectAction(actionId: string, request: RejectActionRequest): Promise<RejectActionResponse> {
  return apiRequest<RejectActionResponse>(`/api/actions/${actionId}/reject`, { method: "POST", body: request });
}

// FR-042: mutation key scoped by actionId, mirroring useApproveAction. Deliberately does not
// invalidate the pending list itself — a network refetch here would also drop any OTHER card this
// session has already approved and is still showing execute in place (§11.19). The caller removes
// this specific card from its own local view once the mutation confirms success.
export function useRejectAction(actionId: string) {
  return useMutation({
    mutationKey: ["actions", actionId, "reject"],
    mutationFn: (request: RejectActionRequest) => rejectAction(actionId, request),
  });
}
