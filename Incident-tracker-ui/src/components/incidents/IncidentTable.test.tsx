import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IncidentTable } from "./IncidentTable";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderTable() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.replaceState(null, "", "/");
  render(
    <QueryClientProvider client={queryClient}>
      <IncidentTable />
    </QueryClientProvider>,
  );
}

const row = {
  id: "inc-1042",
  externalId: "INC-1042",
  priority: "P1",
  status: "INVESTIGATING",
  title: "Connection pool exhausted",
  serviceName: "payments-api",
  environment: "Production",
  category: "Database",
  isKnownIncident: true,
  bestMatchScore: 0.97,
  confidenceScore: 0.91,
  createdAt: "2026-08-16T11:42:00Z",
  assignedTo: "a.reyes",
  automationStatus: "needs_human",
  source: "PagerDuty",
  candidateReason: null,
  recurrenceCount: null,
};

function mockList(body: object, capture?: { url: URL | null }) {
  server.use(
    http.get("/api/incidents", ({ request }) => {
      if (capture) capture.url = new URL(request.url);
      return HttpResponse.json(body);
    }),
  );
}

describe("IncidentTable", () => {
  it("renders rows from the list endpoint", async () => {
    mockList({ rows: [row], totalCount: 1, page: 1 });
    renderTable();
    expect(await screen.findByText("Connection pool exhausted")).toBeInTheDocument();
  });

  it("shows the empty-no-data state when nothing exists and no filter is active", async () => {
    mockList({ rows: [], totalCount: 0, page: 1 });
    renderTable();
    expect(await screen.findByText(/incidents arrive from email/i)).toBeInTheDocument();
  });

  it("shows a distinct empty-filtered state with a one-click clear when a search yields nothing", async () => {
    mockList({ rows: [], totalCount: 0, page: 1 });
    renderTable();
    fireEvent.change(await screen.findByPlaceholderText(/search/i), { target: { value: "nomatch" } });
    expect(await screen.findByText(/no incidents match these filters/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText<HTMLInputElement>(/search/i).value).toBe("");
    });
  });

  it("sends free-text search as the q query param (IT-3)", async () => {
    const capture: { url: URL | null } = { url: null };
    mockList({ rows: [row], totalCount: 1, page: 1 }, capture);
    renderTable();
    await screen.findByText("Connection pool exhausted");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "payments" } });
    await waitFor(() => expect(capture.url?.searchParams.get("q")).toBe("payments"));
  });

  it('toggles "include resolved" and sends it as a query param (IT-4)', async () => {
    const capture: { url: URL | null } = { url: null };
    mockList({ rows: [row], totalCount: 1, page: 1 }, capture);
    renderTable();
    await screen.findByText("Connection pool exhausted");
    fireEvent.click(screen.getByRole("checkbox", { name: /include resolved/i }));
    await waitFor(() => expect(capture.url?.searchParams.get("includeResolved")).toBe("true"));
  });

  it("sorts by clicking a column header (IT-2)", async () => {
    const capture: { url: URL | null } = { url: null };
    mockList({ rows: [row], totalCount: 1, page: 1 }, capture);
    renderTable();
    await screen.findByText("Connection pool exhausted");
    fireEvent.click(screen.getByRole("columnheader", { name: /age/i }));
    await waitFor(() => expect(capture.url?.searchParams.get("sort")).toBe("age"));
  });
});
