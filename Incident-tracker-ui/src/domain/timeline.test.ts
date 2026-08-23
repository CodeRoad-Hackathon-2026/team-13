import { describe, expect, it } from "vitest";
import { cumulativeElapsed } from "./timeline";

describe("cumulativeElapsed", () => {
  const incidentCreatedAt = "2026-08-16T12:00:00Z";

  it("formats seconds under a minute", () => {
    expect(cumulativeElapsed("2026-08-16T12:00:04Z", incidentCreatedAt)).toBe("+4s");
  });

  it("formats minutes and seconds under an hour", () => {
    expect(cumulativeElapsed("2026-08-16T12:02:14Z", incidentCreatedAt)).toBe("+2m 14s");
  });

  it("omits seconds when exactly on a minute boundary", () => {
    expect(cumulativeElapsed("2026-08-16T12:05:00Z", incidentCreatedAt)).toBe("+5m");
  });

  it("formats hours and minutes at or beyond an hour", () => {
    expect(cumulativeElapsed("2026-08-16T13:30:00Z", incidentCreatedAt)).toBe("+1h 30m");
  });

  it("never reports a negative elapsed time", () => {
    expect(cumulativeElapsed("2026-08-16T11:59:00Z", incidentCreatedAt)).toBe("+0s");
  });
});
