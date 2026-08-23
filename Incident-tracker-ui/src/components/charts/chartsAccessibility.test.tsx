import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { AutomationFunnel } from "./AutomationFunnel";
import { ExecutionOutcomeDonut } from "./ExecutionOutcomeDonut";
import type { FunnelStage } from "../../domain/funnel";
import type { PerformanceOutcomes } from "../../api/dashboard/performance";

beforeEach(() => {
  window.history.replaceState(null, "", "/?tab=performance");
});

const stages: FunnelStage[] = [
  { key: "received", label: "Incidents received", count: 142, dropCount: null },
  { key: "classified", label: "Classified by AI", count: 142, dropCount: 0 },
];

const outcomes: PerformanceOutcomes = {
  counts: { success: 71, failed: 6, rolledBack: 3, running: 2 },
  successRatePercent: 87,
  medianDurationMinutes: 4,
  byActionType: [],
  recentFailures: [],
};

// A11Y-4: every chart offers a hidden-by-default, toggleable table equivalent fed the exact same
// domain-computed data as its chart sibling.
describe("AccessibleChartTable integration", () => {
  it("AutomationFunnel offers a table view of its own stage data", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AutomationFunnel
          stages={stages}
          automationRate={{ fullyAutomatedPercent: 34, humanAssistedPercent: 28 }}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view as table/i }));

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Incidents received");
    expect(table).toHaveTextContent("142");
  });

  it("ExecutionOutcomeDonut offers a table view of its own outcome data", () => {
    render(<ExecutionOutcomeDonut outcomes={outcomes} />);

    fireEvent.click(screen.getByRole("button", { name: /view as table/i }));

    const tables = screen.getAllByRole("table");
    const accessibleTable = tables.find((t) => /success/i.test(t.textContent ?? ""));
    expect(accessibleTable).toBeDefined();
    expect(accessibleTable).toHaveTextContent("71");
  });
});
