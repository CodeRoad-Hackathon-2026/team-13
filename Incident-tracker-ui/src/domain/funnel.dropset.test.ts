import { describe, expect, it } from "vitest";
import { dropSetFor } from "./funnel";
import type { FunnelStage } from "./funnel";

const stages: FunnelStage[] = [
  { key: "received", label: "Incidents received", count: 142, dropCount: null },
  { key: "classified", label: "Classified by AI", count: 142, dropCount: 0 },
  { key: "ragMatched", label: "RAG match found", count: 98, dropCount: 44 },
  { key: "validatedResolved", label: "Validated + resolved", count: null, dropCount: null },
];

describe("dropSetFor", () => {
  it("the first stage has no drop-set — clicking it jumps to all incidents in range via funnelStage=received (FR-088)", () => {
    const selection = dropSetFor(stages, 0);
    expect(selection).toEqual({ kind: "funnelStage", key: "received", label: "All incidents in range" });
  });

  it("names the drop-set as reached-preceding-but-not-this stage, via funnelDropAt (FR-085)", () => {
    const selection = dropSetFor(stages, 2);
    expect(selection).toEqual({
      kind: "funnelDropAt",
      key: "ragMatched",
      label: "Reached Classified by AI but not RAG match found",
    });
  });

  it("a zero-loss stage remains selectable and still produces a normal drop-set selection (FR-087)", () => {
    const selection = dropSetFor(stages, 1);
    expect(selection).toEqual({
      kind: "funnelDropAt",
      key: "classified",
      label: "Reached Incidents received but not Classified by AI",
    });
  });

  it("returns an unavailable selection for a stage with no data, rather than a filter that can never match", () => {
    const selection = dropSetFor(stages, 3);
    expect(selection).toEqual({
      kind: "funnelStage",
      key: "validatedResolved",
      label: "Validated + resolved is not yet available",
      unavailable: true,
    });
  });
});
