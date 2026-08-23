import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApprovalQueue } from "./ApprovalQueue";
import { OperatorProvider } from "../../state/OperatorContext";
import type { PendingApprovalsData } from "../../api/approvals/pending";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.setItem("incident-tracker:operator-name", "a.reyes");
});

function makeCard(id: string, description: string): PendingApprovalsData["cards"][number] {
  return {
    id,
    incidentId: `inc-${id}`,
    incidentExternalId: `INC-${id}`,
    priority: "P2",
    serviceName: "auth-gateway",
    environment: "Production",
    incidentTitle: `Incident for ${id}`,
    actionType: "API",
    description,
    riskLevel: "LOW",
    confidenceScore: 0.9,
    topMatches: [],
    proposedAt: "2026-08-17T11:00:00Z",
    proposedByAgent: "Remediation Planner",
  };
}

// Deliberately NOT last: removing it shifts card-b down one array index. An index-keyed list
// (the FR-042/§11.19 bug this test exists to catch) would tear down and remount whatever sits at
// card-b's new index — losing its live executing state — instead of recognizing it's still card-b.
const cardA = makeCard("act-a", "Restart cache warmer");
const cardC = makeCard("act-c", "Purge stale sessions");
const cardB = makeCard("act-b", "Rotate leaked credential");

function renderQueue() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OperatorProvider>
        <ApprovalQueue />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

function mockRunningExecution(actionId: string) {
  server.use(
    http.post(`/api/actions/${actionId}/approve`, () =>
      HttpResponse.json({ executedActionId: `exec-${actionId}`, status: "RUNNING" }, { status: 202 }),
    ),
    http.get(`/api/actions/${actionId}/execution`, () =>
      HttpResponse.json({ status: "RUNNING", errorMessage: null, startedAt: new Date().toISOString(), finishedAt: null }),
    ),
  );
}

describe("ApprovalQueue sibling survival (FR-042,§11.19)", () => {
  it("keeps executing siblings' DOM identity and live state intact when a middle card is rejected and removed", async () => {
    // Stateful, like the real fixture handlers: reject mutates this list, and the pending GET
    // (re-fetched via invalidateQueries once reject is confirmed) reflects that mutation.
    let cards = [cardA, cardC, cardB];
    server.use(
      http.get("/api/approvals/pending", () => HttpResponse.json({ cards, autoExecutedCountInRange: 14 })),
      http.post("/api/actions/act-c/reject", () => {
        cards = cards.filter((c) => c.id !== "act-c");
        return HttpResponse.json({ status: "REJECTED", approvedBy: "a.reyes", approvedAt: new Date().toISOString() });
      }),
    );
    mockRunningExecution("act-a");
    mockRunningExecution("act-b");

    renderQueue();
    await screen.findByText("Restart cache warmer");
    expect(screen.getByText("Purge stale sessions")).toBeInTheDocument();
    expect(screen.getByText("Rotate leaked credential")).toBeInTheDocument();

    // Approve A and B — both enter their own executing state, each with its own live poll.
    const approveButtons = screen.getAllByRole("button", { name: /^approve$/i });
    fireEvent.click(approveButtons[0]); // card A
    fireEvent.click(approveButtons[2]); // card B (index 2: A, C, B)

    await waitFor(() => {
      const executing = screen.getAllByText(/^executing/i);
      expect(executing).toHaveLength(2);
    });

    // Capture DOM identity for A's and B's list items before C is touched at all.
    const cardANodeBefore = screen.getByText("Restart cache warmer").closest("li");
    const cardBNodeBefore = screen.getByText("Rotate leaked credential").closest("li");
    expect(cardANodeBefore).not.toBeNull();
    expect(cardBNodeBefore).not.toBeNull();

    // Reject C — this is the "removing one card" half of FR-042.
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Duplicate of another fix" } });
    fireEvent.click(screen.getByRole("button", { name: /submit rejection/i }));

    await waitFor(() => expect(screen.queryByText("Purge stale sessions")).not.toBeInTheDocument());

    // A and B are still present, still executing, and are the SAME DOM nodes as before — proof
    // React did not unmount/remount them when the list shrank around them.
    const cardANodeAfter = screen.getByText("Restart cache warmer").closest("li");
    const cardBNodeAfter = screen.getByText("Rotate leaked credential").closest("li");
    expect(cardANodeAfter).toBe(cardANodeBefore);
    expect(cardBNodeAfter).toBe(cardBNodeBefore);
    expect(screen.getAllByText(/^executing/i)).toHaveLength(2);
  });
});
