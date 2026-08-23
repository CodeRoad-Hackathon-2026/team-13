import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchKnowledge } from "./knowledge";
import type { KnowledgeData } from "./knowledge";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const body: KnowledgeData = {
  tiles: {
    knowledgeDocumentCount: 70,
    distinctDocumentTypeCount: 4,
    servicesWithRunbookCount: 2,
    totalServiceCount: 6,
    undocumentedResolutionCount: 1,
  },
  coverageGaps: [
    { serviceId: "svc-auth-gateway", serviceName: "auth-gateway", knownRate: 0.43 },
    { serviceId: "svc-payments-api", serviceName: "payments-api", knownRate: 0.71 },
  ],
  documentsDrivingResolutions: [
    { documentId: "doc-1", documentType: "RUNBOOK", title: "Runbook #42", resolutionCount: 23 },
    { documentId: "doc-2", documentType: "INCIDENT", title: "INC-842", resolutionCount: 19 },
  ],
};

describe("fetchKnowledge contract", () => {
  it("returns tiles, coverage gaps, and documents driving resolutions (FR-099,FR-100,FR-102)", async () => {
    server.use(http.get("/api/dashboard/knowledge", () => HttpResponse.json(body)));

    const result = await fetchKnowledge();

    expect(result.tiles.knowledgeDocumentCount).toBe(70);
    expect(result.coverageGaps).toHaveLength(2);
    expect(result.documentsDrivingResolutions).toHaveLength(2);
  });

  it("coverage gaps arrive already sorted ascending by known rate (FR-100)", async () => {
    server.use(http.get("/api/dashboard/knowledge", () => HttpResponse.json(body)));

    const result = await fetchKnowledge();

    expect(result.coverageGaps[0].knownRate).toBeLessThan(result.coverageGaps[1].knownRate);
  });

  it("documents driving resolutions arrive already sorted descending by resolution count (FR-102)", async () => {
    server.use(http.get("/api/dashboard/knowledge", () => HttpResponse.json(body)));

    const result = await fetchKnowledge();

    expect(result.documentsDrivingResolutions[0].resolutionCount).toBeGreaterThan(
      result.documentsDrivingResolutions[1].resolutionCount,
    );
  });
});
