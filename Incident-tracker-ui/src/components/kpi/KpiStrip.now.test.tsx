import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { KpiStripNow } from "./KpiStrip.now";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderStrip() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.replaceState(null, "", "/");
  render(
    <QueryClientProvider client={queryClient}>
      <KpiStripNow />
    </QueryClientProvider>,
  );
}

function mockNow(body: object) {
  server.use(http.get("/api/dashboard/now", () => HttpResponse.json(body)));
}

const baseTiles = {
  openIncidents: { value: 6, deltaVsPrevious: -1 },
  escalated: { value: 1, deltaVsPrevious: 0 },
  unassigned: { value: 3, deltaVsPrevious: 1 },
  oldestOpen: { ageMinutes: 340, priority: "P4" },
};

describe("KpiStripNow", () => {
  it("renders exactly the four operational tiles, never P1-active or awaiting-approval (FR-027)", async () => {
    mockNow(baseTiles);
    renderStrip();
    expect(await screen.findByText("Open incidents")).toBeInTheDocument();
    expect(screen.getByText("Escalated")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Oldest open")).toBeInTheDocument();
    expect(screen.queryByText(/p1 active/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting approval/i)).not.toBeInTheDocument();
  });

  it("marks Escalated urgent and Unassigned cautionary when above zero (FR-029)", async () => {
    mockNow(baseTiles);
    renderStrip();
    await screen.findByText("Escalated");
    expect(screen.getByText("Escalated").closest("button")).toHaveAttribute(
      "data-severity",
      "urgent",
    );
    expect(screen.getByText("Unassigned").closest("button")).toHaveAttribute(
      "data-severity",
      "cautionary",
    );
  });

  it("clicking a tile sets it as the active drill-down filter in the URL", async () => {
    mockNow(baseTiles);
    renderStrip();
    await screen.findByText("Open incidents");
    fireEvent.click(screen.getByText("Open incidents").closest("button")!);
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("filterKey")).toBe("openIncidents");
    });
  });
});
