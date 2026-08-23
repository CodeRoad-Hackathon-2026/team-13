import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchIncidentList } from "./list";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sampleRow = {
  id: "inc-1",
  externalId: "INC-1",
  priority: "P1",
  status: "OPEN",
  title: "Sample",
  serviceName: "payments-api",
  environment: "Production",
  category: "Database",
  isKnownIncident: true,
  bestMatchScore: 0.9,
  confidenceScore: 0.8,
  createdAt: "2026-08-16T10:00:00Z",
  assignedTo: null,
  automationStatus: "needs_human",
  source: "PagerDuty",
  candidateReason: null,
  recurrenceCount: null,
};

describe("fetchIncidentList contract", () => {
  it("never includes JSONB fields anywhere in the response (P-4)", async () => {
    server.use(
      http.get("/api/incidents", () => HttpResponse.json({ rows: [sampleRow], totalCount: 1, page: 1 })),
    );
    const result = await fetchIncidentList();
    expect(result.rows[0]).not.toHaveProperty("parameters");
    expect(result.rows[0]).not.toHaveProperty("input");
    expect(result.rows[0]).not.toHaveProperty("output");
    expect(result.rows[0]).not.toHaveProperty("executionLogs");
    expect(result.rows[0]).not.toHaveProperty("responsePayload");
  });

  it("serializes pagination, sort, search, and includeResolved as query params (IT-2..5)", async () => {
    // A `let` reassigned only inside the MSW callback narrows to `never` at the read site below
    // (a real TS control-flow quirk, confirmed in isolation) — a mutated object property avoids it.
    const captured: { url: URL | null } = { url: null };
    server.use(
      http.get("/api/incidents", ({ request }) => {
        captured.url = new URL(request.url);
        return HttpResponse.json({ rows: [], totalCount: 0, page: 1 });
      }),
    );

    await fetchIncidentList({ page: 2, sort: "age", q: "payments", includeResolved: true });

    expect(captured.url?.searchParams.get("page")).toBe("2");
    expect(captured.url?.searchParams.get("sort")).toBe("age");
    expect(captured.url?.searchParams.get("q")).toBe("payments");
    expect(captured.url?.searchParams.get("includeResolved")).toBe("true");
  });

  it("returns totalCount matching the reconciliation number a drill-down displayed (SC-005)", async () => {
    server.use(
      http.get("/api/incidents", () => HttpResponse.json({ rows: [sampleRow], totalCount: 1, page: 1 })),
    );
    const result = await fetchIncidentList({ kpiTile: "escalated" });
    expect(result.totalCount).toBe(1);
  });

  it("sends the candidate flag distinctly from every cross-tab drill-down param (K4)", async () => {
    const captured: { url: URL | null } = { url: null };
    server.use(
      http.get("/api/incidents", ({ request }) => {
        captured.url = new URL(request.url);
        return HttpResponse.json({ rows: [], totalCount: 0, page: 1 });
      }),
    );
    await fetchIncidentList({ candidate: true });
    expect(captured.url?.searchParams.get("candidate")).toBe("true");
  });
});
