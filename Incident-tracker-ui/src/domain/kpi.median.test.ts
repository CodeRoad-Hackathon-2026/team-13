import { describe, expect, it } from "vitest";
import { formatMedianResolveMinutes, describePerformanceDelta } from "./kpi";

describe("formatMedianResolveMinutes", () => {
  it("formats a real median using the same duration format as incident age", () => {
    expect(formatMedianResolveMinutes(125)).toBe("2h 5m");
  });

  it("guards the zero-resolved-incidents edge case rather than showing 0m (N1b)", () => {
    expect(formatMedianResolveMinutes(null)).toBe("No resolved incidents yet");
  });
});

describe("describePerformanceDelta", () => {
  it("treats a rising median resolve time as bad — lower is better", () => {
    const worse = describePerformanceDelta("medianTimeToResolveMinutes", 10);
    expect(worse?.isGood).toBe(false);
    const better = describePerformanceDelta("medianTimeToResolveMinutes", -10);
    expect(better?.isGood).toBe(true);
  });

  it("treats a rising automation rate as good — higher is better", () => {
    const better = describePerformanceDelta("automationRatePercent", 5);
    expect(better?.isGood).toBe(true);
    const worse = describePerformanceDelta("automationRatePercent", -5);
    expect(worse?.isGood).toBe(false);
  });

  it("treats a rising known-incident hit rate as good — higher is better", () => {
    const better = describePerformanceDelta("knownIncidentHitRate", 3);
    expect(better?.isGood).toBe(true);
  });

  it("returns null when the delta itself is unavailable (zero-resolved-incidents edge case)", () => {
    expect(describePerformanceDelta("medianTimeToResolveMinutes", null)).toBeNull();
  });
});
