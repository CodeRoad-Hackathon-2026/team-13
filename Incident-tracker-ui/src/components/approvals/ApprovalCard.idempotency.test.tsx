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

describe("ApprovalCard approve idempotency (FR-044,X-4,§11.9)", () => {
  it("a double-click on Approve fires exactly one approve request", async () => {
    let requestCount = 0;
    server.use(
      http.post("/api/actions/:id/approve", () => {
        requestCount += 1;
        return HttpResponse.json({ executedActionId: "exec-a3", status: "RUNNING" }, { status: 202 });
      }),
      http.get("/api/actions/:id/execution", () =>
        HttpResponse.json({ status: "RUNNING", errorMessage: null, startedAt: new Date().toISOString(), finishedAt: null }),
      ),
    );

    renderCard();
    const approveButton = screen.getByRole("button", { name: /^approve$/i });
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);

    await waitFor(() => expect(screen.getByText(/executing/i)).toBeInTheDocument());
    expect(requestCount).toBe(1);
  });

  it("three rapid repeat activations before any response arrives still fire exactly one request", async () => {
    let requestCount = 0;
    server.use(
      http.post("/api/actions/:id/approve", async () => {
        requestCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ executedActionId: "exec-a3", status: "RUNNING" }, { status: 202 });
      }),
      http.get("/api/actions/:id/execution", () =>
        HttpResponse.json({ status: "RUNNING", errorMessage: null, startedAt: new Date().toISOString(), finishedAt: null }),
      ),
    );

    renderCard();
    const approveButton = screen.getByRole("button", { name: /^approve$/i });
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);

    await waitFor(() => expect(screen.getByText(/executing/i)).toBeInTheDocument());
    expect(requestCount).toBe(1);
  });
});
