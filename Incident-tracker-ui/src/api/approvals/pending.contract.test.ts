import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchPendingApprovals } from "./pending";
import type { PendingApprovalsData } from "./pending";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const body: PendingApprovalsData = {
  cards: [
    {
      id: "act-a1",
      incidentId: "inc-1042",
      incidentExternalId: "INC-1042",
      priority: "P1",
      serviceName: "payments-api",
      environment: "Production",
      incidentTitle: "Connection pool exhausted on payments-db",
      actionType: "LAMBDA",
      description: "Restart the payments-db connection pool via remediation Lambda",
      riskLevel: "HIGH",
      confidenceScore: 0.91,
      topMatches: [{ documentType: "RUNBOOK", title: "Connection pool runbook", score: 0.97, sourceUrl: "https://runbooks.internal/db-pool" }],
      proposedAt: "2026-08-17T11:42:00Z",
      proposedByAgent: "Remediation Planner",
    },
  ],
  autoExecutedCountInRange: 14,
};

describe("fetchPendingApprovals contract", () => {
  it("returns cards and the positive-empty-state count (FR-031, AR-9)", async () => {
    server.use(http.get("/api/approvals/pending", () => HttpResponse.json(body)));

    const result = await fetchPendingApprovals();

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].id).toBe("act-a1");
    expect(result.cards[0].riskLevel).toBe("HIGH");
    expect(result.cards[0].topMatches[0].title).toBe("Connection pool runbook");
    expect(result.autoExecutedCountInRange).toBe(14);
  });

  it("never includes a parameters field on any card (P-4, FR-118)", async () => {
    server.use(http.get("/api/approvals/pending", () => HttpResponse.json(body)));

    const result = await fetchPendingApprovals();

    expect(result.cards[0]).not.toHaveProperty("parameters");
  });
});
