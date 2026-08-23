import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DocumentationCandidates } from "./DocumentationCandidates";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.history.replaceState(null, "", "/?tab=knowledge");
});

function renderCandidates() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DocumentationCandidates />
    </QueryClientProvider>,
  );
}

function mockCandidates(rows: object[]) {
  server.use(
    http.get("/api/incidents", ({ request }) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("candidate")).toBe("true");
      return HttpResponse.json({ rows, totalCount: rows.length, page: 1 });
    }),
  );
}

const withRecurrence = {
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
  candidateReason: "resolved manually in 3h 20m · no RAG match found",
  recurrenceCount: 3,
};

const withoutRecurrence = {
  ...withRecurrence,
  id: "inc-1040",
  externalId: "INC-1040",
  title: "Checkout 5xx rate above 8% in eu-west",
  status: "ESCALATED",
  resolvedAt: null,
  candidateReason: "no RAG match found",
  recurrenceCount: null,
};

describe("DocumentationCandidates", () => {
  it("consumes GET /api/incidents?candidate=true and shows why each row qualifies (K4,FR-103)", async () => {
    mockCandidates([withRecurrence]);
    renderCandidates();

    expect(await screen.findByText("Payment webhook signature failures")).toBeInTheDocument();
    expect(screen.getByText(/resolved manually in 3h 20m/i)).toBeInTheDocument();
    expect(screen.getByText("payments-api")).toBeInTheDocument();
  });

  it("shows the recurrence count only when it exceeds one (FR-103)", async () => {
    mockCandidates([withRecurrence, withoutRecurrence]);
    renderCandidates();

    await screen.findByText("Payment webhook signature failures");
    expect(screen.getByText(/recurred 3 times/i)).toBeInTheDocument();
    expect(screen.queryByText(/recurred 1 time/i)).not.toBeInTheDocument();
  });

  it("row click opens the drawer, identically to every other row-click in this product (K4,FR-104)", async () => {
    mockCandidates([withRecurrence]);
    renderCandidates();

    const row = await screen.findByText("Payment webhook signature failures");
    fireEvent.click(row.closest("li")!);

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("incident")).toBe("inc-1033"),
    );
  });

  it("opens on Enter for keyboard users (A11Y-3)", async () => {
    mockCandidates([withRecurrence]);
    renderCandidates();

    const row = await screen.findByText("Payment webhook signature failures");
    fireEvent.keyDown(row.closest("li")!, { key: "Enter" });

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("incident")).toBe("inc-1033"),
    );
  });

  it("shows a positive empty state when there are no candidates", async () => {
    mockCandidates([]);
    renderCandidates();

    expect(await screen.findByText(/every resolved incident has a match/i)).toBeInTheDocument();
  });
});
