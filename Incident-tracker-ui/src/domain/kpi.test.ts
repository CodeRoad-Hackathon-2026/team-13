import { describe, expect, it } from "vitest";
import { describeDelta } from "./kpi";

// FR-008: a rising open-incident count is never an improvement — all three Now tiles
// (openIncidents, escalated, unassigned) are "lower is better."
describe("describeDelta", () => {
  it.each(["openIncidents", "escalated", "unassigned"] as const)(
    "marks a decrease as good for %s",
    (tile) => {
      expect(describeDelta(tile, -3).isGood).toBe(true);
    },
  );

  it.each(["openIncidents", "escalated", "unassigned"] as const)(
    "marks an increase as bad for %s — rising is never an improvement",
    (tile) => {
      expect(describeDelta(tile, 2).isGood).toBe(false);
    },
  );

  it("treats no change as good (not a regression)", () => {
    expect(describeDelta("openIncidents", 0).isGood).toBe(true);
  });

  it("labels a decrease with a down arrow and the absolute magnitude", () => {
    expect(describeDelta("escalated", -3).label).toBe("↓ 3");
  });

  it("labels an increase with an up arrow", () => {
    expect(describeDelta("unassigned", 2).label).toBe("↑ 2");
  });
});
