import type { TimeRange } from "./filters";

export type BucketGranularity = "hour" | "day";

// FR-095/Assumption 4: hour buckets only for 24h; day buckets for 7d/30d and "all" (the PRD only
// specifies 24h/7d/30d explicitly — "all" extends the 7d/30d rule rather than introducing a third
// granularity).
export function bucketGranularityFor(timeRange: TimeRange): BucketGranularity {
  return timeRange === "24h" ? "hour" : "day";
}

// Bucket boundaries are server-computed UTC instants (day buckets land on UTC midnight, e.g.
// "2026-08-06"). Formatting them in the viewer's local zone would shift the label by a day for
// anyone west of UTC — pin the format to UTC so the label matches the bucket the server meant.
export function formatBucketLabel(bucketStart: string, granularity: BucketGranularity): string {
  const date = new Date(bucketStart);
  if (granularity === "hour") {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
