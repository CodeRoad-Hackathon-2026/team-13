import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type { FeedbackType, Priority } from "./types";
import type { IncidentDetail } from "./incidents/detail";

export interface SubmitFeedbackRequest {
  actor: string;
  feedbackType: FeedbackType;
  comments: string;
  correctedCategory?: string;
  correctedPriority?: Priority;
  correctedResolution?: string;
}

export type FeedbackRecord = IncidentDetail["feedback"][number];

// FR-073: writes developer_feedback from the always-available §D7 form. The response is the new
// row in the same shape as the drawer's own feedback array — the caller prepends it directly
// rather than refetching the whole drawer.
export function submitFeedback(incidentId: string, request: SubmitFeedbackRequest): Promise<FeedbackRecord> {
  return apiRequest<FeedbackRecord>(`/api/incidents/${incidentId}/feedback`, { method: "POST", body: request });
}

export function useSubmitFeedback(incidentId: string) {
  return useMutation({
    mutationKey: ["incidents", incidentId, "feedback"],
    mutationFn: (request: SubmitFeedbackRequest) => submitFeedback(incidentId, request),
  });
}
