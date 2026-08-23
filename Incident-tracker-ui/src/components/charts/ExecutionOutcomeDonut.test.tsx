import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExecutionOutcomeDonut } from "./ExecutionOutcomeDonut";
import type { PerformanceOutcomes } from "../../api/dashboard/performance";

const outcomes: PerformanceOutcomes = {
  counts: { success: 71, failed: 6, rolledBack: 3, running: 2 },
  successRatePercent: 87,
  medianDurationMinutes: 4,
  byActionType: [],
  recentFailures: [],
};

describe("ExecutionOutcomeDonut", () => {
  // FR-090 asks for a centre label, so the figure and its caption are now separate elements
  // stacked in the donut's hole — they used to be one line of text sitting beside it, which is
  // why asserting the number and the words on a single node passed while the centre stayed empty.
  it("shows the success rate as the centre label (FR-090)", () => {
    render(<ExecutionOutcomeDonut outcomes={outcomes} />);

    const caption = screen.getByText(/^success rate$/i);
    const centre = caption.parentElement;

    expect(centre).toHaveTextContent("87%");
    // Overlaid on the donut, so it must not eat the segments' hover targets.
    expect(centre?.className).toContain("pointer-events-none");
  });

  it("counts and displays rolled-back separately from both success and failed everywhere (FR-091,EO-1)", () => {
    render(<ExecutionOutcomeDonut outcomes={outcomes} />);
    expect(screen.getByText("Rolled back")).toBeInTheDocument();
    const rolledBackRow = screen.getByText("Rolled back").closest("li");
    expect(rolledBackRow).toHaveTextContent("3");

    const failedRow = screen.getByText("Failed").closest("li");
    expect(failedRow).toHaveTextContent("6");
    expect(failedRow).not.toHaveTextContent("9"); // never 6+3 folded together
  });

  it("never folds rolled-back into the failed count", () => {
    render(<ExecutionOutcomeDonut outcomes={outcomes} />);
    const counts = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(counts.some((text) => text?.includes("Failed") && text.includes("6"))).toBe(true);
    expect(counts.some((text) => text?.includes("Rolled back") && text.includes("3"))).toBe(true);
  });
});
