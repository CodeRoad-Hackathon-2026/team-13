import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { usePerformance } from "./performance";
import { useKnowledge } from "./knowledge";
import { useBreakdowns } from "./breakdowns";

const EMPTY_PERFORMANCE = {
  tiles: {
    automationRatePercent: { value: 34, deltaVsPrevious: 0 },
    medianTimeToResolveMinutes: { value: 20, averageMinutes: 22, deltaVsPrevious: 0 },
    knownIncidentHitRate: { value: 60, deltaVsPrevious: 0 },
  },
  funnel: { stages: [], automationRate: { fullyAutomatedPercent: 0, humanAssistedPercent: 0 } },
  outcomes: {
    counts: { success: 0, failed: 0, rolledBack: 0, running: 0 },
    successRatePercent: 0,
    medianDurationMinutes: null,
    byActionType: [],
    recentFailures: [],
  },
};

const EMPTY_KNOWLEDGE = {
  tiles: {
    knowledgeDocumentCount: 0,
    distinctDocumentTypeCount: 0,
    servicesWithRunbookCount: 0,
    totalServiceCount: 0,
    undocumentedResolutionCount: 0,
  },
  coverageGaps: [],
  documentsDrivingResolutions: [],
};

const EMPTY_BREAKDOWNS = { volume: [], byPriority: [], byCategory: [], byService: [] };

const server = setupServer(
  http.get("/api/dashboard/performance", () => HttpResponse.json(EMPTY_PERFORMANCE)),
  http.get("/api/dashboard/knowledge", () => HttpResponse.json(EMPTY_KNOWLEDGE)),
  http.get("/api/dashboard/breakdowns", () => HttpResponse.json(EMPTY_BREAKDOWNS)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient();
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

// FR-108/X-2: Performance and Knowledge (and Breakdowns, which lives on Performance) refresh on
// filter change and every 5 minutes — a slower cadence than the alert strip's unconditional 30s.
describe("Performance/Knowledge/Breakdowns 5-minute polling cadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("usePerformance refetches after 5 minutes without any filter change", async () => {
    let requestCount = 0;
    server.use(
      http.get("/api/dashboard/performance", () => {
        requestCount += 1;
        return HttpResponse.json(EMPTY_PERFORMANCE);
      }),
    );

    renderWithClient(() => usePerformance());
    await vi.waitFor(() => expect(requestCount).toBe(1));

    await vi.advanceTimersByTimeAsync(300_000);
    await vi.waitFor(() => expect(requestCount).toBe(2));
  });

  it("useKnowledge refetches after 5 minutes without any filter change", async () => {
    let requestCount = 0;
    server.use(
      http.get("/api/dashboard/knowledge", () => {
        requestCount += 1;
        return HttpResponse.json(EMPTY_KNOWLEDGE);
      }),
    );

    renderWithClient(() => useKnowledge());
    await vi.waitFor(() => expect(requestCount).toBe(1));

    await vi.advanceTimersByTimeAsync(300_000);
    await vi.waitFor(() => expect(requestCount).toBe(2));
  });

  it("useBreakdowns refetches after 5 minutes without any filter change", async () => {
    let requestCount = 0;
    server.use(
      http.get("/api/dashboard/breakdowns", () => {
        requestCount += 1;
        return HttpResponse.json(EMPTY_BREAKDOWNS);
      }),
    );

    renderWithClient(() => useBreakdowns());
    await vi.waitFor(() => expect(requestCount).toBe(1));

    await vi.advanceTimersByTimeAsync(300_000);
    await vi.waitFor(() => expect(requestCount).toBe(2));
  });
});
