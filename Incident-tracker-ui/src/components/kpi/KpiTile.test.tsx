import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KpiTile } from "./KpiTile";

describe("KpiTile", () => {
  it("renders the label and value", () => {
    render(<KpiTile label="Open incidents" value={6} />);
    expect(screen.getByText("Open incidents")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("marks itself urgent when severity is urgent, with a text label not colour alone (A11Y-1)", () => {
    render(<KpiTile label="Escalated" value={1} severity="urgent" />);
    expect(screen.getByRole("button")).toHaveAttribute("data-severity", "urgent");
    expect(screen.getByText("Escalated")).toBeInTheDocument();
  });

  it("marks itself cautionary when severity is cautionary", () => {
    render(<KpiTile label="Unassigned" value={3} severity="cautionary" />);
    expect(screen.getByRole("button")).toHaveAttribute("data-severity", "cautionary");
  });

  it("calls onClick when clicked, to set the drill-down (FR-028)", () => {
    const onClick = vi.fn();
    render(<KpiTile label="Open incidents" value={6} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders a delta with a text label alongside the good/bad styling", () => {
    render(<KpiTile label="Open incidents" value={6} delta={{ label: "↓ 3", isGood: true }} />);
    expect(screen.getByText("↓ 3")).toHaveAttribute("data-good", "true");
  });

  it("marks itself active when it is the current drill-down", () => {
    render(<KpiTile label="Escalated" value={1} isActive />);
    expect(screen.getByRole("button")).toHaveAttribute("data-active", "true");
  });
});
