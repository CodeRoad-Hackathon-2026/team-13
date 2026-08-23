import { describe, expect, it } from "vitest";
import {
  elapsedExecutionMs,
  isStillRunning,
  pollIntervalMs,
  formatElapsedMs,
  FAST_POLL_MS,
  SLOW_POLL_MS,
} from "./execution";
import type { Clock } from "./clock";

function clockAt(iso: string): Clock {
  return { now: () => new Date(iso) };
}

const startedAt = "2026-08-17T12:00:00Z";

describe("elapsedExecutionMs", () => {
  it("computes elapsed time since startedAt", () => {
    expect(elapsedExecutionMs(startedAt, clockAt("2026-08-17T12:00:30Z"))).toBe(30_000);
  });
});

describe("isStillRunning", () => {
  it("is false before the 2-minute bound (FR-041)", () => {
    expect(isStillRunning(startedAt, clockAt("2026-08-17T12:01:59Z"))).toBe(false);
  });

  it("is true at and after the 2-minute bound", () => {
    expect(isStillRunning(startedAt, clockAt("2026-08-17T12:02:00Z"))).toBe(true);
    expect(isStillRunning(startedAt, clockAt("2026-08-17T12:05:00Z"))).toBe(true);
  });
});

describe("pollIntervalMs", () => {
  it("returns the fast cadence before the bound", () => {
    expect(pollIntervalMs(startedAt, clockAt("2026-08-17T12:00:10Z"))).toBe(FAST_POLL_MS);
  });

  it("returns the slow cadence after the bound", () => {
    expect(pollIntervalMs(startedAt, clockAt("2026-08-17T12:03:00Z"))).toBe(SLOW_POLL_MS);
  });
});

describe("formatElapsedMs", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatElapsedMs(45_000)).toBe("45s");
  });

  it("formats minute-plus durations as minutes and seconds", () => {
    expect(formatElapsedMs(125_000)).toBe("2m 5s");
  });

  it("omits seconds when exactly on a minute boundary", () => {
    expect(formatElapsedMs(120_000)).toBe("2m");
  });
});
