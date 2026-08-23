import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { AutomationFunnel } from "./AutomationFunnel";
import type { FunnelStage } from "../../domain/funnel";

beforeEach(() => {
  window.history.replaceState(null, "", "/?tab=performance");
});

const stages: FunnelStage[] = [
  { key: "received", label: "Incidents received", count: 142, dropCount: null },
  { key: "classified", label: "Classified by AI", count: 142, dropCount: 0 },
  { key: "ragMatched", label: "RAG match found", count: 98, dropCount: 44 },
  { key: "recommended", label: "Action recommended", count: 87, dropCount: 11 },
  { key: "approvedOrAutoRun", label: "Approved / auto-run", count: 79, dropCount: 8 },
  { key: "executedSuccessfully", label: "Executed successfully", count: 71, dropCount: 8 },
  { key: "validatedResolved", label: "Validated + resolved", count: null, dropCount: null },
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

describe("AutomationFunnel", () => {
  it("renders every stage with its count and percentage of the stage above (FR-083)", () => {
    renderFunnel();
    expect(screen.getByText("Incidents received")).toBeInTheDocument();
    expect(screen.getAllByText("142")).toHaveLength(2); // received and classified both count 142
    const ragMatchedButton = screen.getByRole("button", { name: /rag match found/i });
    expect(ragMatchedButton).toHaveTextContent("98");
    expect(ragMatchedButton).toHaveTextContent("69%");
  });

  it("renders validatedResolved as explicitly unavailable, not zero (Assumption 5)", () => {
    renderFunnel();
    expect(screen.getByText(/not yet available/i)).toBeInTheDocument();
  });

  it("annotates the largest stage-to-stage drop, computed from dropCount (FR-084)", () => {
    renderFunnel();
    expect(screen.getByText(/largest drop/i)).toHaveTextContent(
      /classified by ai.*rag match found.*44/i,
    );
  });

  it("clicking a stage triggers the cross-tab jump to its drop-set (FR-085,FR-086)", async () => {
    renderFunnel();
    fireEvent.click(screen.getByRole("button", { name: /rag match found/i }));

    await waitFor(() => expect(new URLSearchParams(window.location.search).get("tab")).toBeNull());
    expect(new URLSearchParams(window.location.search).get("filterKey")).toBe("ragMatched");
    expect(new URLSearchParams(window.location.search).get("filterCrossTab")).toBe("true");
  });

  it("a zero-loss stage stays clickable and jumps to its (empty) drop-set (FR-087)", async () => {
    renderFunnel();
    const classifiedButton = screen.getByRole("button", { name: /classified by ai/i });
    expect(classifiedButton).not.toBeDisabled();

    fireEvent.click(classifiedButton);
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("filterKey")).toBe("classified"),
    );
  });

  it("the first stage has no drop-set — it jumps to all incidents via funnelStage=received, replacing any prior filter (FR-088)", async () => {
    window.history.replaceState(
      null,
      "",
      "/?tab=performance&filterKind=kpiTile&filterKey=openIncidents&filterLabel=Open",
    );
    renderFunnel();

    fireEvent.click(screen.getByRole("button", { name: /incidents received/i }));

    await waitFor(() => expect(new URLSearchParams(window.location.search).get("tab")).toBeNull());
    expect(new URLSearchParams(window.location.search).get("filterKind")).toBe("funnelStage");
    expect(new URLSearchParams(window.location.search).get("filterKey")).toBe("received");
  });

  it("an unavailable stage is disabled rather than producing a dead-end filter", () => {
    renderFunnel();
    expect(screen.getByRole("button", { name: /validated \+ resolved/i })).toBeDisabled();
  });
});
