import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchPerformance } from "./performance";
import type { PerformanceData } from "./performance";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const body: PerformanceData = {
  tiles: {
    automationRatePercent: { value: 62, deltaVsPrevious: 3 },
    medianTimeToResolveMinutes: { value: 125, averageMinutes: 210, deltaVsPrevious: -10 },
    knownIncidentHitRate: { value: 71, deltaVsPrevious: 2 },
  },
  funnel: {
    stages: [
      { key: "received", label: "Incidents received", count: 142, dropCount: null },
      { key: "classified", label: "Classified by AI", count: 142, dropCount: 0 },
      { key: "ragMatched", label: "RAG match found", count: 98, dropCount: 44 },
      { key: "recommended", label: "Action recommended", count: 87, dropCount: 11 },
      { key: "approvedOrAutoRun", label: "Approved / auto-run", count: 79, dropCount: 8 },
      { key: "executedSuccessfully", label: "Executed successfully", count: 71, dropCount: 8 },
      { key: "validatedResolved", label: "Validated + resolved", count: null, dropCount: null },
    ],
    automationRate: { fullyAutomatedPercent: 34, humanAssistedPercent: 28 },
  },
  outcomes: {
    counts: { success: 71, failed: 6, rolledBack: 3, running: 2 },
    successRatePercent: 89,
    medianDurationMinutes: 4,
    byActionType: [
      { actionType: "SQL", success: 20, failed: 2, rolledBack: 1, running: 0, medianDurationMinutes: 3 },
      { actionType: "LAMBDA", success: 30, failed: 1, rolledBack: 1, running: 1, medianDurationMinutes: 4 },
    ],
    recentFailures: [
      { executedActionId: "exec-9", incidentId: "inc-1030", actionType: "SQL", truncatedErrorMessage: "deadlock detected" },
    ],
  },
};

describe("fetchPerformance contract", () => {
  it("returns tiles, funnel, and outcomes as one response (FR-080,FR-083,FR-090)", async () => {
    server.use(http.get("/api/dashboard/performance", () => HttpResponse.json(body)));

    const result = await fetchPerformance();

    expect(result.tiles.automationRatePercent.value).toBe(62);
    expect(result.funnel.stages).toHaveLength(7);
    expect(result.outcomes.counts.rolledBack).toBe(3);
  });

  it("keeps rolledBack distinct from failed and success everywhere it appears (EO-1)", async () => {
    server.use(http.get("/api/dashboard/performance", () => HttpResponse.json(body)));

    const result = await fetchPerformance();

    expect(result.outcomes.counts).toEqual({ success: 71, failed: 6, rolledBack: 3, running: 2 });
    expect(result.outcomes.byActionType[0]).toHaveProperty("rolledBack");
  });

  it("never merges fullyAutomatedPercent/humanAssistedPercent into a single number (FR-089)", async () => {
    server.use(http.get("/api/dashboard/performance", () => HttpResponse.json(body)));

    const result = await fetchPerformance();

    expect(result.funnel.automationRate.fullyAutomatedPercent).toBe(34);
    expect(result.funnel.automationRate.humanAssistedPercent).toBe(28);
  });

  it("passes from/to/env/service as query params", async () => {
    const captured: { url: URL | null } = { url: null };
    server.use(
      http.get("/api/dashboard/performance", ({ request }) => {
        captured.url = new URL(request.url);
        return HttpResponse.json(body);
      }),
    );

    await fetchPerformance({ from: "2026-08-01", to: "2026-08-17", environment: ["Production"], service: null });

    expect(captured.url?.searchParams.get("from")).toBe("2026-08-01");
    expect(captured.url?.searchParams.get("to")).toBe("2026-08-17");
    expect(captured.url?.searchParams.get("env")).toBe("Production");
  });
});
