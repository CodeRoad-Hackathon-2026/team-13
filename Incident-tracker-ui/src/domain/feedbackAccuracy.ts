import type { FeedbackType, Priority } from "../api/types";

export interface FeedbackRow {
  incidentId: string;
  feedbackType: FeedbackType;
  correctedCategory: string | null;
  correctedPriority: Priority | null;
}

// FR-075: APPROVED always agrees. A CORRECTED row agrees only when neither corrected field was
// actually overridden — the correction equals the original because nothing was recorded to
// disagree with. REJECTED is about an action, not a classification, so it never agrees.
export function isAgreement(row: Pick<FeedbackRow, "feedbackType" | "correctedCategory" | "correctedPriority">): boolean {
  if (row.feedbackType === "APPROVED") return true;
  if (row.feedbackType === "CORRECTED") return row.correctedCategory === null && row.correctedPriority === null;
  return false;
}

// FR-075/Assumption 14: denominator is incidents carrying any feedback — never all incidents.
// An incident with multiple feedback rows counts as a disagreement if any row disagreed.
export function computeAccuracyPercent(rows: FeedbackRow[]): number | null {
  if (rows.length === 0) return null;

  const agreesByIncident = new Map<string, boolean>();
  for (const row of rows) {
    const agrees = isAgreement(row);
    const existing = agreesByIncident.get(row.incidentId);
    agreesByIncident.set(row.incidentId, existing === undefined ? agrees : existing && agrees);
  }

  const incidents = [...agreesByIncident.values()];
  const agreeing = incidents.filter(Boolean).length;
  return Math.round((agreeing / incidents.length) * 100);
}

// FI-4/§11.20/FR-077: below 10 team-wide corrections, the widget is suppressed entirely — never
// shown with a caveat, since a number from too few data points is misleading.
export function isSuppressed(teamCorrectionCount: number): boolean {
  return teamCorrectionCount < 10;
}
