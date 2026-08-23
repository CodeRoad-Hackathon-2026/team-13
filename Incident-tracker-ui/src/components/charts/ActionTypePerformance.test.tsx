import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionTypePerformance } from "./ActionTypePerformance";
import type { PerformanceOutcomes } from "../../api/dashboard/performance";

const byActionType: PerformanceOutcomes["byActionType"] = [
  { actionType: "SQL", success: 20, failed: 2, rolledBack: 1, running: 0, medianDurationMinutes: 3 },
  {
    actionType: "LAMBDA",
    success: 25,
    failed: 1,
    rolledBack: 1,
    running: 1,
    medianDurationMinutes: 4,
  },
];

describe("ActionTypePerformance", () => {
  // EO-3/FR-093 used to be a disclosure inside the outcomes card. It is a card of its own now,
  // always visible and carrying runs and median duration as well as the raw counts.
  it("breaks execution performance down by action type (EO-3,FR-093)", () => {
    render(<ActionTypePerformance byActionType={byActionType} />);

    expect(screen.getByRole("cell", { name: "SQL" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "LAMBDA" })).toBeInTheDocument();
  });

  it("orders by runs, busiest first — the type that runs most is the one whose success rate matters", () => {
    render(<ActionTypePerformance byActionType={byActionType} />);

    const firstColumn = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")?.textContent);

    expect(firstColumn.slice(0, 2)).toEqual(["LAMBDA", "SQL"]); // 28 runs before 23
  });

  it("rates success over settled runs, so an in-flight execution does not count against it", () => {
    render(<ActionTypePerformance byActionType={byActionType} />);

    // LAMBDA: 25 of 27 settled = 93%. Over all 28 runs it would read 89% and then climb on its
    // own the moment the running one lands, with nothing having changed.
    const lambdaRow = screen.getByRole("cell", { name: "LAMBDA" }).closest("tr");
    expect(lambdaRow).toHaveTextContent("93%");
  });

  it("says a type is still running rather than scoring it 0%", () => {
    render(
      <ActionTypePerformance
        byActionType={[
          {
            actionType: "API",
            success: 0,
            failed: 0,
            rolledBack: 0,
            running: 2,
            medianDurationMinutes: null,
          },
        ]}
      />,
    );

    const row = screen.getByRole("cell", { name: "API" }).closest("tr");
    expect(row).toHaveTextContent(/still running/i);
    expect(row).not.toHaveTextContent("0%");
  });

  it("has an empty state rather than an empty table", () => {
    render(<ActionTypePerformance byActionType={[]} />);
    expect(screen.getByText(/no remediation has run/i)).toBeInTheDocument();
  });
});
