import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { AutomationFunnel } from "./AutomationFunnel";
import type { FunnelStage } from "../../domain/funnel";

beforeEach(() => {
  window.history.replaceState(null, "", "/?tab=performance");
});

const stages: FunnelStage[] = [
  { key: "received", label: "Incidents received", count: 142, dropCount: null },
];

function renderFunnel() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AutomationFunnel
        stages={stages}
        automationRate={{ fullyAutomatedPercent: 34, humanAssistedPercent: 28 }}
      />
    </QueryClientProvider>,
  );
}

describe("AutomationFunnel automation-rate split (§6.1,FR-089)", () => {
  it("always renders fully-automated and human-assisted as two separate numbers", () => {
    renderFunnel();
    expect(screen.getByText(/fully automated/i)).toHaveTextContent("34%");
    expect(screen.getByText(/human-assisted/i)).toHaveTextContent("28%");
  });

  it("never merges them into a single blended number anywhere in this component", () => {
    renderFunnel();
    expect(screen.queryByText("62%")).not.toBeInTheDocument();
  });
});
