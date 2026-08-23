import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchIncidentList } from "./list";
import type { IncidentListResponse } from "./list";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const candidateRow: IncidentListResponse["rows"][number] = {
  id: "inc-1033",
  externalId: "INC-1033",
  priority: "P1",
  status: "RESOLVED",
  title: "Payment webhook signature failures",
  serviceName: "payments-api",
  environment: "Production",
  category: "API",
  isKnownIncident: false,
  bestMatchScore: null,
  confidenceScore: 0.51,
  createdAt: "2026-08-13T12:00:00Z",
  assignedTo: "a.reyes",
  automationStatus: "none",
  source: "PagerDuty",
  candidateReason: "resolved manually in 3h 20m · no match found · recurred 3 times",
  recurrenceCount: 3,
};

describe("fetchIncidentList candidate=true contract", () => {
  it("sends candidate=true as a query param", async () => {
    const captured: { url: URL | null } = { url: null };
    server.use(
      http.get("/api/incidents", ({ request }) => {
        captured.url = new URL(request.url);
        return HttpResponse.json({ rows: [candidateRow], totalCount: 1, page: 1 });
      }),
    );

    await fetchIncidentList({ candidate: true });

    expect(captured.url?.searchParams.get("candidate")).toBe("true");
  });

  it("populates candidateReason and recurrenceCount only for candidate rows (K4,FR-103)", async () => {
    server.use(http.get("/api/incidents", () => HttpResponse.json({ rows: [candidateRow], totalCount: 1, page: 1 })));

    const result = await fetchIncidentList({ candidate: true });

    expect(result.rows[0].candidateReason).toMatch(/resolved manually/i);
    expect(result.rows[0].recurrenceCount).toBe(3);
  });
});
