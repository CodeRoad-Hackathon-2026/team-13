import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VolumeChart } from "./VolumeChart";
import type { VolumeBucket } from "../../api/dashboard/breakdowns";

const dayBuckets: VolumeBucket[] = [
  { bucketStart: "2026-08-06", known: 9, unknown: 5, medianResolutionMinutes: 21 },
  { bucketStart: "2026-08-07", known: 12, unknown: 4, medianResolutionMinutes: 22 },
];

function openTable() {
  fireEvent.click(screen.getByRole("button", { name: /view as table/i }));
  return screen.getByRole("table");
}

// FR-095/Assumption 4: day buckets for 7d/30d/all, hour buckets for 24h.
describe("VolumeChart bucket granularity", () => {
  it.each(["7d", "30d", "all"] as const)("labels buckets by day for the %s range", (timeRange) => {
    render(<VolumeChart buckets={dayBuckets} timeRange={timeRange} />);
    const table = openTable();
    expect(table).toHaveTextContent(/aug 6/i);
    expect(table).toHaveTextContent(/aug 7/i);
  });

  it("labels buckets by hour for the 24h range", () => {
    const hourBuckets: VolumeBucket[] = [
      { bucketStart: "2026-08-16T14:00:00Z", known: 3, unknown: 1, medianResolutionMinutes: 10 },
    ];
    render(<VolumeChart buckets={hourBuckets} timeRange="24h" />);
    const table = openTable();
    expect(table).not.toHaveTextContent(/aug/i);
    expect(table).toHaveTextContent(/\d/);
  });

  it("stacks known and unknown counts per bucket (FR-095)", () => {
    render(<VolumeChart buckets={dayBuckets} timeRange="7d" />);
    const table = openTable();
    expect(table).toHaveTextContent("9");
    expect(table).toHaveTextContent("5");
    expect(table).toHaveTextContent("12");
    expect(table).toHaveTextContent("4");
  });
});
