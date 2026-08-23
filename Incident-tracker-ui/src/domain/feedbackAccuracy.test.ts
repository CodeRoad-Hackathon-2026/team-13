import { describe, expect, it } from "vitest";
import { isAgreement, computeAccuracyPercent } from "./feedbackAccuracy";
import type { FeedbackRow } from "./feedbackAccuracy";

describe("isAgreement", () => {
  it("an APPROVED row is always agreement", () => {
    expect(isAgreement({ feedbackType: "APPROVED", correctedCategory: null, correctedPriority: null })).toBe(true);
  });

  it("a CORRECTED row with no actual override recorded equals the original — still agreement (FR-075)", () => {
    expect(isAgreement({ feedbackType: "CORRECTED", correctedCategory: null, correctedPriority: null })).toBe(true);
  });

  it("a CORRECTED row with a real corrected category is disagreement", () => {
    expect(isAgreement({ feedbackType: "CORRECTED", correctedCategory: "Network", correctedPriority: null })).toBe(
      false,
    );
  });

  it("a CORRECTED row with a real corrected priority is disagreement", () => {
    expect(isAgreement({ feedbackType: "CORRECTED", correctedCategory: null, correctedPriority: "P1" })).toBe(false);
  });

  it("a REJECTED row is disagreement", () => {
    expect(isAgreement({ feedbackType: "REJECTED", correctedCategory: null, correctedPriority: null })).toBe(false);
  });
});

describe("computeAccuracyPercent", () => {
  it("denominator is incidents with any feedback; numerator is those with no disagreement (FR-075)", () => {
    const rows: FeedbackRow[] = [
      { incidentId: "inc-1", feedbackType: "APPROVED", correctedCategory: null, correctedPriority: null },
      { incidentId: "inc-2", feedbackType: "APPROVED", correctedCategory: null, correctedPriority: null },
      { incidentId: "inc-3", feedbackType: "CORRECTED", correctedCategory: "Network", correctedPriority: null },
    ];
    expect(computeAccuracyPercent(rows)).toBe(67); // 2 of 3 agree
  });

  it("an incident with multiple feedback rows counts as a disagreement if any of its rows disagree", () => {
    const rows: FeedbackRow[] = [
      { incidentId: "inc-1", feedbackType: "APPROVED", correctedCategory: null, correctedPriority: null },
      { incidentId: "inc-1", feedbackType: "CORRECTED", correctedCategory: null, correctedPriority: "P1" },
      { incidentId: "inc-2", feedbackType: "APPROVED", correctedCategory: null, correctedPriority: null },
    ];
    expect(computeAccuracyPercent(rows)).toBe(50); // inc-1 disagrees, inc-2 agrees — 1 of 2 distinct incidents
  });

  it("excludes incidents with no feedback entirely — returns null with zero rows, never 0%", () => {
    expect(computeAccuracyPercent([])).toBeNull();
  });
});
