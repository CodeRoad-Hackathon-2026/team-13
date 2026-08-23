import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { KpiStripPerformance } from "./KpiStrip.performance";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderStrip() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.replaceState(null, "", "/?tab=performance");
  render(
    <QueryClientProvider client={queryClient}>
      <KpiStripPerformance />
    </QueryClientProvider>,
  );
}

const tiles = {
  automationRatePercent: { value: 62, deltaVsPrevious: 3 },
  medianTimeToResolveMinutes: { value: 125, averageMinutes: 210, deltaVsPrevious: -10 },
  knownIncidentHitRate: { value: 71, deltaVsPrevious: 2 },
};

function mockPerformance() {
  server.use(
    http.get("/api/dashboard/performance", () =>
      HttpResponse.json({
        tiles,
        funnel: {
          stages: [],
          automationRate: { fullyAutomatedPercent: 34, humanAssistedPercent: 28 },
        },
        outcomes: {
          counts: { success: 0, failed: 0, rolledBack: 0, running: 0 },
          successRatePercent: 0,
          medianDurationMinutes: null,
          byActionType: [],
          recentFailures: [],
        },
      }),
    ),
  );
}

describe("KpiStripPerformance", () => {
  it("renders exactly the three automation tiles (FR-080,N1b)", async () => {
    mockPerformance();
    renderStrip();
    expect(await screen.findByText("Automation rate")).toBeInTheDocument();
    expect(screen.getByText("Median time to resolve")).toBeInTheDocument();
    expect(screen.getByText("Known-incident hit rate")).toBeInTheDocument();
  });

  it("shows the median as the headline value with the average labelled in the tooltip (FR-081,N1b)", async () => {
    mockPerformance();
    renderStrip();
    await screen.findByText("Median time to resolve");
    const tile = screen.getByText("Median time to resolve").closest("button")!;
    expect(tile).toHaveTextContent("2h 5m");
    expect(tile.getAttribute("title")).toMatch(/average.*3h 30m/i);
  });

  it("clicking any tile follows the cross-tab jump rules — switches to Now (FR-082)", async () => {
    mockPerformance();
    renderStrip();
    await screen.findByText("Automation rate");
    fireEvent.click(screen.getByText("Automation rate").closest("button")!);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("tab")).toBeNull());
    expect(new URLSearchParams(window.location.search).get("filterCrossTab")).toBe("true");
  });
});
