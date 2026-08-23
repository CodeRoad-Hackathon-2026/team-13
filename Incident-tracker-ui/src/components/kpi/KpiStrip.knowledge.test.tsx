import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { KpiStripKnowledge } from "./KpiStrip.knowledge";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderStrip() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <KpiStripKnowledge />
    </QueryClientProvider>,
  );
}

function mockKnowledge() {
  server.use(
    http.get("/api/dashboard/knowledge", () =>
      HttpResponse.json({
        tiles: {
          knowledgeDocumentCount: 70,
          distinctDocumentTypeCount: 4,
          servicesWithRunbookCount: 2,
          totalServiceCount: 6,
          undocumentedResolutionCount: 1,
        },
        coverageGaps: [],
        documentsDrivingResolutions: [],
      }),
    ),
  );
}

describe("KpiStripKnowledge", () => {
  it("renders exactly the three Knowledge tiles (FR-099,K1)", async () => {
    mockKnowledge();
    renderStrip();

    expect(await screen.findByText("Knowledge documents")).toBeInTheDocument();
    expect(screen.getByText("Services with a runbook")).toBeInTheDocument();
    expect(screen.getByText("Undocumented resolutions")).toBeInTheDocument();
  });

  it("shows the document-type spread alongside the document count", async () => {
    mockKnowledge();
    renderStrip();

    const tile = await screen.findByText("Knowledge documents");
    expect(tile.closest("button")).toHaveTextContent("70");
    expect(tile.closest("button")).toHaveTextContent(/4 document types/i);
  });

  it("shows services-with-a-runbook out of the total service count", async () => {
    mockKnowledge();
    renderStrip();

    const tile = await screen.findByText("Services with a runbook");
    expect(tile.closest("button")).toHaveTextContent("2");
    expect(tile.closest("button")).toHaveTextContent(/of 6/i);
  });
});
