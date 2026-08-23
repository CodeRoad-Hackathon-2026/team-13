import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchBreakdowns } from "./breakdowns";
import type { BreakdownsData } from "./breakdowns";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const body: BreakdownsData = {
  volume: [
    { bucketStart: "2026-08-06T12:00:00Z", known: 9, unknown: 5, medianResolutionMinutes: 21 },
    { bucketStart: "2026-08-07T12:00:00Z", known: 12, unknown: 4, medianResolutionMinutes: 22 },
  ],
  byPriority: [
    { priority: "P1", count: 11 },
    { priority: "P2", count: 29 },
    { priority: "P3", count: 64 },
    { priority: "P4", count: 38 },
  ],
  byCategory: [
    { category: "Database", count: 44 },
    { category: "API", count: 38 },
    { category: "Infrastructure", count: 31 },
    { category: "Deployment", count: 19 },
    { category: "Auth", count: 7 },
    { category: "Other", count: 3 },
  ],
  byService: [
    { serviceId: "svc-payments-api", serviceName: "payments-api", count: 34, knownRate: 0.71 },
    { serviceId: "svc-checkout-web", serviceName: "checkout-web", count: 28, knownRate: 0.82 },
  ],
};

describe("fetchBreakdowns contract", () => {
  it("returns volume, byPriority, byCategory, byService in one response (FR-095-098)", async () => {
    server.use(http.get("/api/dashboard/breakdowns", () => HttpResponse.json(body)));

    const result = await fetchBreakdowns();

    expect(result.volume).toHaveLength(2);
    expect(result.byPriority).toHaveLength(4);
    expect(result.byCategory[5].category).toBe("Other");
    expect(result.byService).toHaveLength(2);
  });

  it("passes from/to/env as query params", async () => {
    const captured: { url: URL | null } = { url: null };
    server.use(
      http.get("/api/dashboard/breakdowns", ({ request }) => {
        captured.url = new URL(request.url);
        return HttpResponse.json(body);
      }),
    );

    await fetchBreakdowns({ from: "2026-08-01", to: "2026-08-17", environment: ["Production"] });

    expect(captured.url?.searchParams.get("from")).toBe("2026-08-01");
    expect(captured.url?.searchParams.get("env")).toBe("Production");
  });
});
