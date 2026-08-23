import { describe, expect, it } from "vitest";
import { crossTabJump, clearFilter, setFilter, type DashboardViewState } from "./filters";

const baseState: DashboardViewState = {
  tab: "performance",
  timeRange: "30d",
  environment: ["Production"],
  service: null,
  search: "",
  includeResolved: false,
  activeFilter: null,
};

describe("crossTabJump", () => {
  it("switches to Now and applies the filter as one atomic transition (FR-021)", () => {
    const result = crossTabJump(baseState, { kind: "funnelDropAt", key: "ragMatched", label: "Reached classified but not RAG match found" });
    expect(result.tab).toBe("now");
    expect(result.activeFilter).toEqual({
      kind: "funnelDropAt",
      key: "ragMatched",
      label: "Reached classified but not RAG match found",
      isCrossTab: true,
    });
  });

  it("marks the resulting filter as cross-tab-originated, distinct from a same-tab setFilter (FR-022)", () => {
    const sameTab = setFilter(baseState, { kind: "kpiTile", key: "openIncidents", label: "Open incidents" });
    const crossTab = crossTabJump(baseState, { kind: "kpiTile", key: "openIncidents", label: "Open incidents" });
    expect(sameTab.activeFilter?.isCrossTab).toBe(false);
    expect(crossTab.activeFilter?.isCrossTab).toBe(true);
  });

  it("replaces any existing filter rather than accumulating (FR-025)", () => {
    const first = crossTabJump(baseState, { kind: "breakdown", key: "priority:P1", label: "Priority P1" });
    const second = crossTabJump(first, { kind: "funnelStage", key: "recommended", label: "Recommended" });
    expect(second.activeFilter?.key).toBe("recommended");
  });

  it("preserves global filters (time range, environment, service) across the jump", () => {
    const result = crossTabJump(baseState, { kind: "kpiTile", key: "escalated", label: "Escalated" });
    expect(result.timeRange).toBe("30d");
    expect(result.environment).toEqual(["Production"]);
  });
});

describe("clearFilter after a cross-tab jump", () => {
  it("clears the filter only — never navigates back to the originating tab (FR-024,XT-5)", () => {
    const jumped = crossTabJump(baseState, { kind: "funnelDropAt", key: "recommended", label: "Recommended" });
    expect(jumped.tab).toBe("now");

    const cleared = clearFilter(jumped);
    expect(cleared.activeFilter).toBeNull();
    expect(cleared.tab).toBe("now"); // stays on Now — does not return to "performance"
  });
});
