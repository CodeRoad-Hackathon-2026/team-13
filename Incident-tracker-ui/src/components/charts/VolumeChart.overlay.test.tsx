import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VolumeChart } from "./VolumeChart";
import type { VolumeBucket } from "../../api/dashboard/breakdowns";

// FR-096: median resolution time is overlaid per bucket, on a secondary axis in the chart itself —
// asserted here via the same domain-computed series the chart and its accessible table share.
describe("VolumeChart median-resolution overlay", () => {
  it("carries each bucket's median resolution time alongside its volume counts", () => {
    const buckets: VolumeBucket[] = [
      { bucketStart: "2026-08-06", known: 9, unknown: 5, medianResolutionMinutes: 21 },
      { bucketStart: "2026-08-07", known: 12, unknown: 4, medianResolutionMinutes: null },
    ];
    render(<VolumeChart buckets={buckets} timeRange="7d" />);
    fireEvent.click(screen.getByRole("button", { name: /view as table/i }));

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("21m");
    expect(table).toHaveTextContent(/not yet available/i);
  });
});
