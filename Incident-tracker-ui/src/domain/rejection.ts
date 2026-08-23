import type { Priority } from "../api/types";

export interface RejectFormValues {
  reason: string;
  correctedCategory?: string;
  correctedPriority?: Priority;
}

export interface RejectActionRequest {
  actor: string;
  reason: string;
  correctedCategory?: string;
  correctedPriority?: Priority;
}

// FR-038: whitespace-only is not a reason. Shared by RejectForm's client-side validation and the
// server's own 400 guard, so the two never disagree about what counts as "empty."
export function isValidRejection(values: RejectFormValues): boolean {
  return values.reason.trim().length > 0;
}

// AR-6/data-model.md's rejection_reason gap note: this travels to the server as `reason`, which is
// what the server writes into DeveloperFeedback.comments — the client never constructs that row.
export function toRejectRequest(values: RejectFormValues, actor: string): RejectActionRequest {
  const request: RejectActionRequest = { actor, reason: values.reason.trim() };
  if (values.correctedCategory) request.correctedCategory = values.correctedCategory;
  if (values.correctedPriority) request.correctedPriority = values.correctedPriority;
  return request;
}
