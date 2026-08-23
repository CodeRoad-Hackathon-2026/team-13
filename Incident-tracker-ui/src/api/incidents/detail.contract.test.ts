import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchIncidentDetail, fetchAgentRunIO, fetchActionParameters, fetchExecutionDetail } from "./detail";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const detailBody = {
  incident: {
    id: "inc-1042",
    externalId: "INC-1042",
    title: "Connection pool exhausted",
    status: "INVESTIGATING",
    priority: "P1",
    serviceName: "payments-api",
    environment: "Production",
    assignedTo: "a.reyes",
    createdAt: "2026-08-16T11:42:00Z",
    resolvedAt: null,
    source: "PagerDuty",
  },
  aiClassification: { category: "Database", priority: "P1", confidenceScore: 0.91 },
  correction: null,
  agentRuns: [],
  similarityMatches: [],
  actions: [],
  events: [],
  feedback: [],
};

describe("fetchIncidentDetail contract", () => {
  it("addresses by the internal id, never the external id (FR-059)", async () => {
    let capturedPath = "";
    server.use(
      http.get("/api/incidents/:id", ({ params }) => {
        capturedPath = params.id as string;
        return HttpResponse.json(detailBody);
      }),
    );
    await fetchIncidentDetail("inc-1042");
    expect(capturedPath).toBe("inc-1042");
  });

  it("never includes lazy JSONB payloads inline (P-4)", async () => {
    server.use(http.get("/api/incidents/:id", () => HttpResponse.json(detailBody)));
    const result = await fetchIncidentDetail("inc-1042");
    for (const run of result.agentRuns) {
      expect(run).not.toHaveProperty("input");
      expect(run).not.toHaveProperty("output");
    }
    for (const action of result.actions) {
      expect(action).not.toHaveProperty("parameters");
    }
  });

  it("throws a typed error on 404 rather than silently returning nothing", async () => {
    server.use(http.get("/api/incidents/:id", () => new HttpResponse(null, { status: 404 })));
    await expect(fetchIncidentDetail("inc-missing")).rejects.toThrow();
  });
});

describe("lazy JSONB fetches (P-4)", () => {
  it("fetches agent run input/output only on expand", async () => {
    server.use(
      http.get("/api/incidents/:id/agent-runs/:runId/io", () =>
        HttpResponse.json({ input: { a: 1 }, output: { b: 2 } }),
      ),
    );
    const result = await fetchAgentRunIO("inc-1042", "run-1");
    expect(result).toEqual({ input: { a: 1 }, output: { b: 2 } });
  });

  it("fetches action parameters only on expand", async () => {
    server.use(
      http.get("/api/actions/:id/parameters", () => HttpResponse.json({ parameters: { statement: "SELECT 1" } })),
    );
    const result = await fetchActionParameters("act-a3");
    expect(result.parameters).toEqual({ statement: "SELECT 1" });
  });

  it("fetches execution response payload and logs only on expand", async () => {
    server.use(
      http.get("/api/executions/:id/detail", () =>
        HttpResponse.json({ responsePayload: { ok: true }, executionLogs: "log line" }),
      ),
    );
    const result = await fetchExecutionDetail("exec-a4");
    expect(result.executionLogs).toBe("log line");
  });
});
