import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useCrossTabJump } from "./useCrossTabJump";
import { IncidentTable } from "../components/incidents/IncidentTable";
import { CrossTabToast } from "../components/shared/CrossTabToast";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.history.replaceState(null, "", "/?tab=performance");
});

function PerformanceTileStub() {
  const jump = useCrossTabJump();
  return (
    <button
      onClick={() =>
        jump({
          kind: "funnelStage",
          key: "ragMatched",
          label: "Reached classified but not RAG match found",
          toastMessage: "Jumped to Now — incidents that reached but did not pass RAG match found.",
        })
      }
    >
      RAG match found funnel row
    </button>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PerformanceTileStub />
      <IncidentTable />
      <CrossTabToast />
    </QueryClientProvider>,
  );
}

describe("useCrossTabJump", () => {
  it("switches to Now, applies the filter, flashes the table, and fires a toast naming the jump (FR-021,FR-023,XT-1,XT-2,XT-4)", async () => {
    server.use(http.get("/api/incidents", () => HttpResponse.json({ rows: [], totalCount: 0, page: 1 })));

    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: /rag match found funnel row/i }));

    expect(new URLSearchParams(window.location.search).get("tab")).toBeNull(); // "now" is the default, omitted
    await waitFor(() => expect(document.getElementById("incident-table")).toHaveAttribute("data-flash", "true"));
    expect(await screen.findByRole("status")).toHaveTextContent(/jumped to now/i);
  });

  it("renders the resulting chip in the distinct cross-tab style (FR-022,XT-3)", async () => {
    server.use(http.get("/api/incidents", () => HttpResponse.json({ rows: [], totalCount: 0, page: 1 })));

    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: /rag match found funnel row/i }));

    const chip = await screen.findByText("Reached classified but not RAG match found");
    expect(chip.closest("[data-cross-tab]")).toHaveAttribute("data-cross-tab", "true");
  });

  it("replaces any previously active filter rather than accumulating (FR-025)", async () => {
    server.use(http.get("/api/incidents", () => HttpResponse.json({ rows: [], totalCount: 0, page: 1 })));
    window.history.replaceState(null, "", "/?tab=performance&filterKind=kpiTile&filterKey=openIncidents&filterLabel=Open");

    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: /rag match found funnel row/i }));

    expect(await screen.findByText("Reached classified but not RAG match found")).toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
  });
});
