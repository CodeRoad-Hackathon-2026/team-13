import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ExecutionOutcomeDonut } from "./ExecutionOutcomeDonut";
import type { PerformanceOutcomes } from "../../api/dashboard/performance";

beforeEach(() => {
  window.history.replaceState(null, "", "/?tab=performance");
});

const outcomes: PerformanceOutcomes = {
  counts: { success: 71, failed: 6, rolledBack: 3, running: 2 },
  successRatePercent: 87,
  medianDurationMinutes: 4,
  byActionType: [
    { actionType: "SQL", success: 20, failed: 2, rolledBack: 1, running: 0, medianDurationMinutes: 3 },
    { actionType: "LAMBDA", success: 25, failed: 1, rolledBack: 1, running: 1, medianDurationMinutes: 4 },
  ],
  recentFailures: [
    {
      executedActionId: "exec-fail-1",
      incidentId: "inc-1042",
      actionType: "LAMBDA",
      truncatedErrorMessage: "Timed out waiting…",
    },
  ],
};

describe("ExecutionOutcomeDonut details", () => {
  // Label and value are separate elements in a justified row now, so the assertion is on the row
  // rather than on the words.
  it("shows the median execution duration as a caption (EO-4,FR-094)", () => {
    render(<ExecutionOutcomeDonut outcomes={outcomes} />);
    expect(screen.getByText(/median execution duration/i).parentElement).toHaveTextContent("4m");
  });

  it("shows an unavailable caption rather than 0m when there is no data yet", () => {
    render(<ExecutionOutcomeDonut outcomes={{ ...outcomes, medianDurationMinutes: null }} />);
    expect(screen.getByText(/median execution duration/i).parentElement).toHaveTextContent(
      /not yet available/i,
    );
  });

  it("lists the most recent failures with action type, incident, and truncated error (EO-2,FR-092)", () => {
    render(<ExecutionOutcomeDonut outcomes={outcomes} />);
    expect(screen.getByText("LAMBDA")).toBeInTheDocument();
    expect(screen.getByText(/timed out waiting/i)).toBeInTheDocument();
    expect(screen.getByText(/inc-1042/i)).toBeInTheDocument();
  });

  it("opening a recent failure sets the incident id, opening the detail drawer (EO-2)", () => {
    render(<ExecutionOutcomeDonut outcomes={outcomes} />);
    fireEvent.click(screen.getByRole("button", { name: /open incident/i }));
    expect(new URLSearchParams(window.location.search).get("incident")).toBe("inc-1042");
  });

  // EO-3/FR-093's breakdown by action type is no longer a disclosure inside this card — it is its
  // own always-visible table with runs, success rate and median duration. Asserted there; see
  // ActionTypePerformance.test.tsx.
});
