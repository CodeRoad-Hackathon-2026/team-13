import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RiskBadge } from "./RiskBadge";
import { OutcomeBadge } from "./OutcomeBadge";

describe("RiskBadge", () => {
  it.each(["LOW", "MEDIUM", "HIGH"] as const)(
    "renders a text label for %s risk, not colour alone",
    (risk) => {
      render(<RiskBadge risk={risk} />);
      expect(screen.getByText(`${risk} RISK`)).toBeInTheDocument();
    },
  );
});

describe("OutcomeBadge", () => {
  it.each(["SUCCESS", "FAILED", "ROLLED_BACK", "RUNNING"] as const)(
    "renders a text label for %s, never colour alone",
    (status) => {
      render(<OutcomeBadge status={status} />);
      expect(screen.getByText(status.replace("_", " "))).toBeInTheDocument();
    },
  );

  it("keeps ROLLED_BACK visually and textually distinct from FAILED (EO-1)", () => {
    render(<OutcomeBadge status="ROLLED_BACK" />);
    const el = screen.getByText("ROLLED BACK");
    expect(el).toHaveAttribute("data-status", "ROLLED_BACK");
  });
});
