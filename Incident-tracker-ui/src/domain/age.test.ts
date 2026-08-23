import { describe, expect, it } from "vitest";
import { ageMinutes, formatAge, isAgeFlagged } from "./age";

const clock = { now: () => new Date("2026-08-16T12:00:00Z") };

describe("ageMinutes", () => {
  it("computes elapsed minutes from an injected clock", () => {
    expect(ageMinutes("2026-08-16T11:30:00Z", clock)).toBe(30);
  });
});

describe("isAgeFlagged", () => {
  it.each([
    ["P1", 29, false],
    ["P1", 31, true],
    ["P2", 119, false],
    ["P2", 121, true],
    ["P3", 479, false],
    ["P3", 481, true],
    ["P4", 1439, false],
    ["P4", 1441, true],
  ] as const)("priority %s at %i minutes is flagged=%s", (priority, minutes, expected) => {
    const createdAt = new Date(clock.now().getTime() - minutes * 60_000).toISOString();
    expect(isAgeFlagged(createdAt, priority, clock)).toBe(expected);
  });
});

describe("formatAge", () => {
  it("formats minutes under an hour as Nm", () => {
    expect(formatAge(18)).toBe("18m");
  });

  it("formats minutes under a day as Nh Nm", () => {
    expect(formatAge(151)).toBe("2h 31m");
  });

  it("formats minutes at or beyond a day as Nd", () => {
    expect(formatAge(1500)).toBe("1d");
  });
});
