import { useQuery } from "@tanstack/react-query";
import { apiRequest, buildQuery } from "./client";

export interface FeedbackImpactData {
  personal: {
    accuracyPercent: number;
    previousAccuracyPercent: number;
    correctionCount: number;
    lastCorrectionAt: string | null;
  };
  team: { correctionCount: number; engineerCount: number; quarterLabel: string };
  suppressed: boolean;
}

// FR-074-077/Assumption 15: personal figures are all-time, the team figure is fixed to the
// current quarter — neither respects the dashboard's time-range control, so this client sends
// only the operator name, never from/to, regardless of what the endpoint's own signature suggests.
export function fetchFeedbackImpact(user: string): Promise<FeedbackImpactData> {
  const query = buildQuery({ user });
  return apiRequest<FeedbackImpactData>(`/api/feedback/impact${query}`);
}

export function useFeedbackImpact(user: string | null) {
  return useQuery({
    queryKey: ["feedback", "impact", user],
    queryFn: () => fetchFeedbackImpact(user as string),
    enabled: user !== null,
  });
}
