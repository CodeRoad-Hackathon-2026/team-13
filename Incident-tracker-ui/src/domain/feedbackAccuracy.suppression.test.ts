import { describe, expect, it } from "vitest";
import { isSuppressed } from "./feedbackAccuracy";

describe("isSuppressed", () => {
  it("suppresses at 9 team-wide corrections (FI-4,§11.20)", () => {
    expect(isSuppressed(9)).toBe(true);
  });

  it("does not suppress at exactly 10", () => {
    expect(isSuppressed(10)).toBe(false);
  });

  it("does not suppress above 10", () => {
    expect(isSuppressed(61)).toBe(false);
  });

  it("suppresses at zero", () => {
    expect(isSuppressed(0)).toBe(true);
  });
});
