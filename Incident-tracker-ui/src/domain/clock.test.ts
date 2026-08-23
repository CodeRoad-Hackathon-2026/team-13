import { describe, expect, it } from "vitest";
import { systemClock, type Clock } from "./clock";

describe("systemClock", () => {
  it("returns a Date close to the real current time", () => {
    const before = Date.now();
    const now = systemClock.now();
    const after = Date.now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("injected clock", () => {
  it("lets a fixed clock be substituted for the system clock", () => {
    const fixed: Clock = { now: () => new Date("2026-08-16T12:00:00Z") };
    expect(fixed.now().toISOString()).toBe("2026-08-16T12:00:00.000Z");
  });
});
