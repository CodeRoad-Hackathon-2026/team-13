import { describe, expect, it } from "vitest";
import { isValidRejection, toRejectRequest } from "./rejection";

describe("isValidRejection", () => {
  it("rejects an empty reason", () => {
    expect(isValidRejection({ reason: "" })).toBe(false);
  });

  it("rejects a whitespace-only reason (FR-038)", () => {
    expect(isValidRejection({ reason: "   " })).toBe(false);
  });

  it("accepts a non-empty reason", () => {
    expect(isValidRejection({ reason: "Root cause already fixed upstream" })).toBe(true);
  });
});

describe("toRejectRequest", () => {
  it("maps the reason and actor, trimming surrounding whitespace", () => {
    expect(toRejectRequest({ reason: "  Not needed  " }, "a.reyes")).toEqual({
      actor: "a.reyes",
      reason: "Not needed",
    });
  });

  it("includes optional corrections only when supplied", () => {
    expect(
      toRejectRequest({ reason: "Miscategorized", correctedCategory: "Network", correctedPriority: "P2" }, "a.reyes"),
    ).toEqual({
      actor: "a.reyes",
      reason: "Miscategorized",
      correctedCategory: "Network",
      correctedPriority: "P2",
    });
  });

  it("omits corrections when not supplied, rather than sending empty strings", () => {
    const request = toRejectRequest({ reason: "Not needed", correctedCategory: "" }, "a.reyes");
    expect(request).not.toHaveProperty("correctedCategory");
    expect(request).not.toHaveProperty("correctedPriority");
  });
});
