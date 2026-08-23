import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { BreakdownBars } from "./BreakdownBars";

beforeEach(() => {
  window.history.replaceState(null, "", "/?tab=performance");
});

// FR-097/FR-098/P5: three variants over the same shared component; ordering and top-N+Other
// selection are server-side concerns (already covered by the breakdowns contract test) — this
// component just renders whatever order it's given and wires each segment to the cross-tab jump.
describe("BreakdownBars", () => {
  it("renders priority rows in the given order with a text label (A11Y-1)", () => {
    render(
      <BreakdownBars
        variant="priority"
        rows={[
          { priority: "P1", count: 11 },
          { priority: "P2", count: 29 },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /^P[12]/i });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("P1");
    expect(buttons[0]).toHaveTextContent("11");
    expect(buttons[1]).toHaveTextContent("P2");
    expect(buttons[1]).toHaveTextContent("29");
  });

  it("renders category rows including a trailing Other bucket (FR-097)", () => {
    render(
      <BreakdownBars
        variant="category"
        rows={[
          { category: "Database", count: 44 },
          { category: "Other", count: 3 },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: /Other/i });
    expect(button).toHaveTextContent("Other");
    expect(button).toHaveTextContent("3");
  });

  it("renders service rows with their known-rate inline (FR-097)", () => {
    render(
      <BreakdownBars
        variant="service"
        rows={[
          {
            serviceId: "svc-payments-api",
            serviceName: "payments-api",
            count: 34,
            knownRate: 0.71,
          },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: /payments-api/i });
    expect(button).toHaveTextContent("payments-api");
    expect(button).toHaveTextContent("34");
    expect(button).toHaveTextContent("71% known");
  });

  it("priority and category segments don't render a known-rate (only service carries one)", () => {
    render(<BreakdownBars variant="priority" rows={[{ priority: "P1", count: 11 }]} />);
    expect(screen.queryByText(/known/i)).not.toBeInTheDocument();
  });

  it("clicking a priority segment triggers the identical cross-tab jump as a funnel stage (FR-098)", async () => {
    render(<BreakdownBars variant="priority" rows={[{ priority: "P1", count: 11 }]} />);
    fireEvent.click(screen.getByRole("button", { name: /P1/i }));

    await waitFor(() => expect(new URLSearchParams(window.location.search).get("tab")).toBeNull());
    expect(new URLSearchParams(window.location.search).get("filterKind")).toBe("breakdown");
    expect(new URLSearchParams(window.location.search).get("filterKey")).toBe("priority:P1");
    expect(new URLSearchParams(window.location.search).get("filterCrossTab")).toBe("true");
  });

  it("clicking a category segment jumps with a category: breakdown key", async () => {
    render(<BreakdownBars variant="category" rows={[{ category: "Database", count: 44 }]} />);
    fireEvent.click(screen.getByRole("button", { name: /Database/i }));

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("filterKey")).toBe(
        "category:Database",
      ),
    );
  });

  it("clicking a service segment jumps with a service: breakdown key", async () => {
    render(
      <BreakdownBars
        variant="service"
        rows={[
          {
            serviceId: "svc-payments-api",
            serviceName: "payments-api",
            count: 34,
            knownRate: 0.71,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /payments-api/i }));

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("filterKey")).toBe(
        "service:svc-payments-api",
      ),
    );
  });

  it("offers a table view equivalent (A11Y-4)", () => {
    render(<BreakdownBars variant="priority" rows={[{ priority: "P1", count: 11 }]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view as table/i }));
    expect(screen.getByRole("table")).toHaveTextContent("P1");
  });
});
