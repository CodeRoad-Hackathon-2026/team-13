import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IncidentDetailDrawer } from "./IncidentDetailDrawer";
import { OperatorProvider } from "../../state/OperatorContext";
import { useUrlState } from "../../state/useUrlState";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

const detail = {
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

function mockDetail() {
  server.use(http.get("/api/incidents/:id", () => HttpResponse.json(detail)));
}

function TriggerRow() {
  const { setIncident } = useUrlState();
  return <button onClick={() => setIncident("inc-1042")}>Open row</button>;
}

function renderWithTrigger() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OperatorProvider>
        <TriggerRow />
        <IncidentDetailDrawer />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

async function waitForDrawer() {
  return screen.findByRole("dialog");
}

describe("IncidentDetailDrawer", () => {
  it("does not render when no incident is selected in the URL", () => {
    renderWithTrigger();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens when ?incident= is present and is deep-linkable (FR-058/FR-059)", async () => {
    mockDetail();
    window.history.replaceState(null, "", "/?incident=inc-1042");
    renderWithTrigger();
    await waitForDrawer();
    expect(await screen.findByText("Connection pool exhausted")).toBeInTheDocument();
  });

  it("closes on Escape and clears the URL (FR-058)", async () => {
    mockDetail();
    window.history.replaceState(null, "", "/?incident=inc-1042");
    renderWithTrigger();
    await waitForDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(new URLSearchParams(window.location.search).get("incident")).toBeNull();
  });

  it("closes on scrim click", async () => {
    mockDetail();
    window.history.replaceState(null, "", "/?incident=inc-1042");
    renderWithTrigger();
    await waitForDrawer();
    fireEvent.click(screen.getByTestId("scrim"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("returns focus to the opening row once closed (A11Y-3)", async () => {
    mockDetail();
    renderWithTrigger();
    const opener = screen.getByRole("button", { name: /open row/i });
    opener.focus();
    fireEvent.click(opener);
    await waitForDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });
});
