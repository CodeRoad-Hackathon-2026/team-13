import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUrlState } from "./useUrlState";

function setUrl(search: string) {
  window.history.replaceState(null, "", search ? `/?${search}` : "/");
}

beforeEach(() => {
  setUrl("");
});

afterEach(() => {
  setUrl("");
});

describe("useUrlState", () => {
  it("defaults to the now tab, 7d range, and Production environment", () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.tab).toBe("now");
    expect(result.current.timeRange).toBe("7d");
    expect(result.current.environment).toEqual(["Production"]);
  });

  it("round-trips a full state through the URL", () => {
    const { result } = renderHook(() => useUrlState());
    act(() => {
      result.current.setTab("performance");
      result.current.setTimeRange("30d");
      result.current.setSearch("payments");
      result.current.setIncident("inc-1042");
    });
    const { result: fresh } = renderHook(() => useUrlState());
    expect(fresh.current.tab).toBe("performance");
    expect(fresh.current.timeRange).toBe("30d");
    expect(fresh.current.search).toBe("payments");
    expect(fresh.current.incidentId).toBe("inc-1042");
  });

  it("falls back to now for an unrecognized tab value (FR-017)", () => {
    setUrl("tab=nonexistent");
    const { result } = renderHook(() => useUrlState());
    expect(result.current.tab).toBe("now");
  });

  it("setFilter replaces rather than accumulates, and survives a tab switch (FR-020)", () => {
    const { result } = renderHook(() => useUrlState());
    act(() => {
      result.current.setFilter({ kind: "kpiTile", key: "openIncidents", label: "Open" });
    });
    act(() => {
      result.current.setTab("performance");
    });
    expect(result.current.activeFilter).toEqual({
      kind: "kpiTile",
      key: "openIncidents",
      label: "Open",
      isCrossTab: false,
    });
    act(() => {
      result.current.setTab("now");
    });
    expect(result.current.activeFilter).toEqual({
      kind: "kpiTile",
      key: "openIncidents",
      label: "Open",
      isCrossTab: false,
    });
  });

  it("crossTabJump switches to now and marks the filter cross-tab, and it round-trips through the URL (FR-021,FR-022)", () => {
    const { result } = renderHook(() => useUrlState());
    act(() => {
      result.current.setTab("performance");
      result.current.crossTabJump({ kind: "funnelDropAt", key: "ragMatched", label: "Reached classified but not RAG match" });
    });
    expect(result.current.tab).toBe("now");
    expect(result.current.activeFilter).toEqual({
      kind: "funnelDropAt",
      key: "ragMatched",
      label: "Reached classified but not RAG match",
      isCrossTab: true,
    });

    const { result: fresh } = renderHook(() => useUrlState());
    expect(fresh.current.activeFilter?.isCrossTab).toBe(true);
  });

  it("clearFilter clears the filter without disturbing other state or the tab", () => {
    const { result } = renderHook(() => useUrlState());
    act(() => {
      result.current.setFilter({ kind: "breakdown", key: "priority:P1", label: "P1" });
      result.current.setTab("performance");
      result.current.setSearch("x");
    });
    act(() => {
      result.current.clearFilter();
    });
    expect(result.current.activeFilter).toBeNull();
    expect(result.current.tab).toBe("performance");
    expect(result.current.search).toBe("x");
  });
});
