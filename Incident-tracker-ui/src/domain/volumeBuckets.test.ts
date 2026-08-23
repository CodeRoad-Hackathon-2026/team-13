import { describe, expect, it } from "vitest";
import { bucketGranularityFor, formatBucketLabel } from "./volumeBuckets";

describe("bucketGranularityFor", () => {
  it("uses hour buckets for the 24h range (FR-095)", () => {
    expect(bucketGranularityFor("24h")).toBe("hour");
  });

  it("uses day buckets for 7d (FR-095)", () => {
    expect(bucketGranularityFor("7d")).toBe("day");
  });

  it("uses day buckets for 30d (FR-095)", () => {
    expect(bucketGranularityFor("30d")).toBe("day");
  });

  it("uses day buckets for all, extending the 7d/30d rule (Assumption 4)", () => {
    expect(bucketGranularityFor("all")).toBe("day");
  });
});

describe("formatBucketLabel", () => {
  it("formats hour buckets as a time", () => {
    const label = formatBucketLabel("2026-08-16T14:00:00Z", "hour");
    expect(label).toMatch(/\d{1,2}/);
    expect(label).not.toMatch(/2026/);
  });

  it("formats day buckets as a short date", () => {
    const label = formatBucketLabel("2026-08-06T12:00:00Z", "day");
    expect(label).toMatch(/aug/i);
    expect(label).toMatch(/6/);
  });

  it("anchors day buckets to UTC, not the viewer's local time zone (real bucketStart values are UTC-midnight dates)", () => {
    const label = formatBucketLabel("2026-08-06", "day");
    expect(label).toMatch(/aug/i);
    expect(label).toMatch(/6/);
  });
});
