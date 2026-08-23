import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApprovalCard } from "./ApprovalCard";
import { OperatorProvider } from "../../state/OperatorContext";
import type { PendingApprovalCard } from "../../api/approvals/pending";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.setItem("incident-tracker:operator-name", "a.reyes");
});

const card: PendingApprovalCard = {
  id: "act-a3",
  incidentId: "inc-1038",
  incidentExternalId: "INC-1038",
  priority: "P2",
  serviceName: "auth-gateway",
  environment: "Production",
  incidentTitle: "Refresh-token index blocked",
  actionType: "SQL",
  description: "Clear expired refresh-token rows blocking the unique index",
  riskLevel: "LOW",
  confidenceScore: 0.62,
  topMatches: [],
  proposedAt: "2026-08-17T11:00:00Z",
  proposedByAgent: "Remediation Planner",
};

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OperatorProvider>
        <ul>
          <ApprovalCard card={card} />
        </ul>
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

function mockApproveAndExecution(startedAt: string) {
  server.use(
    http.post("/api/actions/:id/approve", () =>
      HttpResponse.json({ executedActionId: "exec-a3", status: "RUNNING" }, { status: 202 }),
    ),
    // Always RUNNING at this fixed startedAt — the card must never infer FAILED from elapsed time.
    http.get("/api/actions/:id/execution", () =>
      HttpResponse.json({ status: "RUNNING", errorMessage: null, startedAt, finishedAt: null }),
    ),
  );
}

describe("ApprovalCard execution timeout (FR-041)", () => {
  it("shows the fast Executing state before the 2-minute bound", async () => {
    mockApproveAndExecution(new Date().toISOString());
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(await screen.findByText(/^executing/i)).toBeInTheDocument();
    expect(screen.queryByText(/still running/i)).not.toBeInTheDocument();
  });

  it('switches to "still running" once startedAt is past the 2-minute bound, offering a manual re-check, never a failure it hasn\'t observed', async () => {
    mockApproveAndExecution(new Date(Date.now() - 130_000).toISOString());
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(await screen.findByText(/still running/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check now/i })).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });

  it('"check now" re-fetches on demand', async () => {
    mockApproveAndExecution(new Date(Date.now() - 130_000).toISOString());
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await screen.findByText(/still running/i);

    let refetchCount = 0;
    server.use(
      http.get("/api/actions/:id/execution", () => {
        refetchCount += 1;
        return HttpResponse.json({
          status: "RUNNING",
          errorMessage: null,
          startedAt: new Date(Date.now() - 130_000).toISOString(),
          finishedAt: null,
        });
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /check now/i }));
    await waitFor(() => expect(refetchCount).toBeGreaterThan(0));
  });
});
