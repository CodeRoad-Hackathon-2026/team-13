import { describe, expect, it } from "vitest";
import { describeAutomation } from "./automationIcon";

describe("describeAutomation", () => {
  it.each([
    ["fully_automated", "🤖", "Fully automated"],
    ["human_approved", "👤", "Human-approved"],
    ["needs_human", "⚠️", "Needs human"],
    ["none", "—", "No automation"],
  ] as const)("maps %s to an icon and a text label, never icon alone (A11Y-1)", (status, icon, label) => {
    expect(describeAutomation(status)).toEqual({ icon, label });
  });
});
