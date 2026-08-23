import { describe, expect, it } from "vitest";
import { sortAscendingByKnownRate, highestLeverageFixCaption } from "./coverageGaps";
import type { CoverageGapService } from "./coverageGaps";

const services: CoverageGapService[] = [
  { serviceId: "svc-payments-api", serviceName: "payments-api", knownRate: 0.71 },
  { serviceId: "svc-checkout-web", serviceName: "checkout-web", knownRate: 0.82 },
  { serviceId: "svc-auth-gateway", serviceName: "auth-gateway", knownRate: 0.43 },
  { serviceId: "svc-notify-worker", serviceName: "notify-worker", knownRate: 0.94 },
];

describe("sortAscendingByKnownRate", () => {
  it("sorts worst (lowest known-incident rate) first, never by volume (FR-100,K2)", () => {
    const sorted = sortAscendingByKnownRate(services);
    expect(sorted.map((s) => s.serviceName)).toEqual([
      "auth-gateway",
      "payments-api",
      "checkout-web",
      "notify-worker",
    ]);
  });

  it("does not mutate the input array", () => {
    const copy = [...services];
    sortAscendingByKnownRate(services);
    expect(services).toEqual(copy);
  });
});

describe("highestLeverageFixCaption", () => {
  it("names the worst service explicitly, not leaving the inference to the reader (FR-101)", () => {
    expect(highestLeverageFixCaption(services)).toBe(
      "Fixing auth-gateway would move the funnel more than any model change.",
    );
  });

  it("returns null when there is no coverage-gap data at all", () => {
    expect(highestLeverageFixCaption([])).toBeNull();
  });
});
