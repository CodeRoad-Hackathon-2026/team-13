import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AgentRunTrace } from "./AgentRunTrace";
import type { IncidentDetail } from "../../api/incidents/detail";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const runs: IncidentDetail["agentRuns"] = [
  {
    id: "run-1",
    agentName: "classifier",
    agentVersion: "1.4.0",
    status: "SUCCEEDED",
    startedAt: "2026-08-16T11:42:00Z",
    finishedAt: "2026-08-16T11:42:03Z",
    latencyMs: 2800,
    confidenceScore: 0.91,
    hasError: false,
  },
  {
    id: "run-2",
    agentName: "remediation-planner",
    agentVersion: "2.0.1",
    status: "FAILED",
    startedAt: "2026-08-16T11:43:00Z",
    finishedAt: "2026-08-16T11:43:01Z",
    latencyMs: 900,
    confidenceScore: null,
    hasError: true,
  },
];

function renderTrace(runList = runs) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AgentRunTrace incidentId="inc-1" runs={runList} />
    </QueryClientProvider>,
  );
}

describe("AgentRunTrace", () => {
  it("lists agent runs in start order with name, version, status, duration, confidence (FR-064)", () => {
    renderTrace();
    expect(screen.getByText(/classifier v1\.4\.0/)).toBeInTheDocument();
    expect(screen.getByText("SUCCEEDED")).toBeInTheDocument();
    expect(screen.getByText("2.8s")).toBeInTheDocument();
    expect(screen.getByText("0.91")).toBeInTheDocument();
  });

  it("flags a failed run distinctly", () => {
    renderTrace();
    const entries = screen.getAllByRole("listitem");
    expect(entries[1]).toHaveAttribute("data-error", "true");
  });

  it("expands a failed run by default with its error visible, while others stay collapsed (FR-065)", () => {
    renderTrace();
    expect(screen.getByRole("button", { name: /classifier v1\.4\.0/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /remediation-planner v2\.0\.1/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("does not fetch input/output until expanded (P-4)", async () => {
    const capture: { called: boolean } = { called: false };
    server.use(
      http.get("/api/incidents/inc-1/agent-runs/run-1/io", () => {
        capture.called = true;
        return HttpResponse.json({ input: { foo: "bar" }, output: { result: "ok" } });
      }),
    );
    renderTrace();
    expect(capture.called).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /classifier v1\.4\.0/ }));
    await waitFor(() => expect(capture.called).toBe(true));
    expect(await screen.findByText(/"foo": "bar"/)).toBeInTheDocument();
  });

  it("renders an empty message when there are no agent runs", () => {
    renderTrace([]);
    expect(screen.getByText(/no agent runs recorded/i)).toBeInTheDocument();
  });
});
