import { describe, expect, it } from "vitest";
import { clearFilter, setFilter, setTab, type DashboardViewState } from "./filters";

const baseState: DashboardViewState = {
  tab: "now",
  timeRange: "7d",
  environment: ["Production"],
  service: null,
  search: "",
  includeResolved: false,
  activeFilter: null,
};

describe("setFilter", () => {
  it("replaces the active filter rather than accumulating", () => {
    const first = setFilter(baseState, { kind: "kpiTile", key: "openIncidents", label: "Open" });
    const second = setFilter(first, { kind: "funnelDropAt", key: "recommended", label: "Recommended" });
    expect(second.activeFilter).toEqual({
      kind: "funnelDropAt",
      key: "recommended",
      label: "Recommended",
      isCrossTab: false,
    });
  });

  it("leaves every other field untouched", () => {
    const result = setFilter(baseState, { kind: "kpiTile", key: "escalated", label: "Escalated" });
    expect(result.tab).toBe("now");
    expect(result.timeRange).toBe("7d");
    expect(result.environment).toEqual(["Production"]);
    expect(result.service).toBeNull();
    expect(result.search).toBe("");
    expect(result.includeResolved).toBe(false);
  });
});

describe("clearFilter", () => {
  it("nulls the active filter without disturbing global filters or the tab", () => {
    const filtered = setFilter(baseState, { kind: "breakdown", key: "priority:P1", label: "Priority P1" });
    const cleared = clearFilter(filtered);
    expect(cleared.activeFilter).toBeNull();
    expect(cleared.tab).toBe(filtered.tab);
    expect(cleared.timeRange).toBe(filtered.timeRange);
    expect(cleared.environment).toEqual(filtered.environment);
    expect(cleared.search).toBe(filtered.search);
  });
});

describe("setTab", () => {
  it("changes the tab without clearing the active filter (FR-020)", () => {
    const filtered = setFilter(baseState, { kind: "kpiTile", key: "unassigned", label: "Unassigned" });
    const switched = setTab(filtered, "performance");
    expect(switched.tab).toBe("performance");
    expect(switched.activeFilter).toEqual(filtered.activeFilter);
  });

  it("preserves search and includeResolved across a switch in both directions", () => {
    const withSearch: DashboardViewState = { ...baseState, search: "payments", includeResolved: true };
    const toPerf = setTab(withSearch, "performance");
    const backToNow = setTab(toPerf, "now");
    expect(backToNow.search).toBe("payments");
    expect(backToNow.includeResolved).toBe(true);
  });
});
