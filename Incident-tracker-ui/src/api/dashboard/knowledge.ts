import { useQuery } from "@tanstack/react-query";
import { apiRequest, buildQuery } from "../client";
import type { DocumentType } from "../types";
import type { CoverageGapService } from "../../domain/coverageGaps";

export interface KnowledgeTiles {
  knowledgeDocumentCount: number;
  distinctDocumentTypeCount: number;
  servicesWithRunbookCount: number;
  totalServiceCount: number;
  undocumentedResolutionCount: number;
}

export interface DocumentDrivingResolution {
  documentId: string;
  documentType: DocumentType;
  title: string;
  resolutionCount: number;
}

export interface KnowledgeData {
  tiles: KnowledgeTiles;
  coverageGaps: CoverageGapService[];
  documentsDrivingResolutions: DocumentDrivingResolution[];
}

export interface KnowledgeParams {
  from?: string;
  to?: string;
}

// FR-099-102: the three Knowledge-tab panels (tiles, coverage gaps, documents driving
// resolutions) in one response — K4's documentation-candidates list is served by the incidents
// endpoint instead (contracts/dashboard-endpoints.md), since it's fundamentally an incident list.
export function fetchKnowledge(params: KnowledgeParams = {}): Promise<KnowledgeData> {
  const query = buildQuery({ from: params.from, to: params.to });
  return apiRequest<KnowledgeData>(`/api/dashboard/knowledge${query}`);
}

// FR-108: refreshes on filter change (via queryKey) and every 5 minutes regardless — Knowledge is
// the other tab polled on this slower cadence than the alert strip's 30s (X-2).
export function useKnowledge(params: KnowledgeParams = {}) {
  return useQuery({
    queryKey: ["dashboard", "knowledge", params],
    queryFn: () => fetchKnowledge(params),
    refetchInterval: 300_000,
  });
}
