import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccessibleChartTable } from "./AccessibleChartTable";

const columns = [
  { key: "priority", label: "Priority" },
  { key: "count", label: "Count" },
] as const;
const rows = [
  { priority: "P1", count: 11 },
  { priority: "P2", count: 29 },
];

describe("AccessibleChartTable", () => {
  it("is hidden by default and toggled visible by the control (A11Y-4)", () => {
    render(<AccessibleChartTable caption="By priority" columns={columns} rows={rows} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view as table/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders every row and column of the same series the chart is fed", () => {
    render(<AccessibleChartTable caption="By priority" columns={columns} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /view as table/i }));
    expect(screen.getByText("By priority")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Priority" })).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("29")).toBeInTheDocument();
  });
});
