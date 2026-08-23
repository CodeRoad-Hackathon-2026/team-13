import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { ActionType, DocumentType, Environment, Priority, RiskLevel } from "../types";

export interface PendingApprovalCard {
  id: string;
  incidentId: string;
  incidentExternalId: string;
  priority: Priority;
  serviceName: string;
  environment: Environment;
  incidentTitle: string;
  actionType: ActionType;
  description: string;
  riskLevel: RiskLevel;
  confidenceScore: number;
  topMatches: Array<{ documentType: DocumentType; title: string; score: number; sourceUrl: string }>;
  proposedAt: string;
  proposedByAgent: string;
}

export interface PendingApprovalsData {
  cards: PendingApprovalCard[];
  autoExecutedCountInRange: number;
}

// FR-031/FR-032/AR-9/AR-10: server already excludes approval_required=false and sorts
// priority→risk→age — no client-side filtering or re-sorting (P-3).
export function fetchPendingApprovals(): Promise<PendingApprovalsData> {
  return apiRequest<PendingApprovalsData>("/api/approvals/pending");
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: fetchPendingApprovals,
  });
}
