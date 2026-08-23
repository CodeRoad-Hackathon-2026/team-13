import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { OperatorProvider, useOperator } from "./OperatorContext";

beforeEach(() => {
  window.localStorage.clear();
});

describe("OperatorContext", () => {
  it("starts with no operator name when localStorage is empty", () => {
    const { result } = renderHook(() => useOperator(), { wrapper: OperatorProvider });
    expect(result.current.operatorName).toBeNull();
  });

  it("persists a set name to localStorage and reflects it immediately", () => {
    const { result } = renderHook(() => useOperator(), { wrapper: OperatorProvider });
    act(() => {
      result.current.setOperatorName("a.reyes");
    });
    expect(result.current.operatorName).toBe("a.reyes");
    expect(window.localStorage.getItem("incident-tracker:operator-name")).toBe("a.reyes");
  });

  it("restores a previously persisted name on a fresh mount", () => {
    window.localStorage.setItem("incident-tracker:operator-name", "m.tan");
    const { result } = renderHook(() => useOperator(), { wrapper: OperatorProvider });
    expect(result.current.operatorName).toBe("m.tan");
  });

  it("allows changing an already-set name", () => {
    const { result } = renderHook(() => useOperator(), { wrapper: OperatorProvider });
    act(() => {
      result.current.setOperatorName("a.reyes");
    });
    act(() => {
      result.current.setOperatorName("j.okafor");
    });
    expect(result.current.operatorName).toBe("j.okafor");
  });

  it("exposes the default low-confidence threshold of 0.70", () => {
    const { result } = renderHook(() => useOperator(), { wrapper: OperatorProvider });
    expect(result.current.lowConfidenceThreshold).toBe(0.7);
  });
});
