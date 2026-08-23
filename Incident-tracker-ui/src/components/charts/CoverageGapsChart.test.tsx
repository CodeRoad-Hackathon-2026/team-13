import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoverageGapsChart } from "./CoverageGapsChart";
import type { CoverageGapService } from "../../domain/coverageGaps";

const services: CoverageGapService[] = [
  { serviceId: "svc-payments-api", serviceName: "payments-api", knownRate: 0.71 },
  { serviceId: "svc-notify-worker", serviceName: "notify-worker", knownRate: 0.94 },
  { serviceId: "svc-auth-gateway", serviceName: "auth-gateway", knownRate: 0.43 },
];

describe("CoverageGapsChart", () => {
  it("renders services worst-first, never sorted by volume (FR-100,K2)", () => {
    render(<CoverageGapsChart services={services} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("auth-gateway"),
      expect.stringContaining("payments-api"),
      expect.stringContaining("notify-worker"),
    ]);
  });

  it("carries a red/amber/green threshold with a text label, never colour alone (A11Y-1)", () => {
    render(<CoverageGapsChart services={services} />);
    expect(screen.getByText("auth-gateway").closest("li")).toHaveTextContent("RED"); // 43%
    expect(screen.getByText("payments-api").closest("li")).toHaveTextContent("AMBER"); // 71%
    expect(screen.getByText("notify-worker").closest("li")).toHaveTextContent("GREEN"); // 94%
  });

  it("names the highest-leverage fix explicitly in a caption (FR-101)", () => {
    render(<CoverageGapsChart services={services} />);
    expect(screen.getByText(/fixing auth-gateway would move the funnel/i)).toBeInTheDocument();
  });

  it("offers an accessible table view fed the same data (A11Y-4)", () => {
    render(<CoverageGapsChart services={services} />);
    expect(screen.getByRole("button", { name: /view as table/i })).toBeInTheDocument();
  });
});
