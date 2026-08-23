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

describe("ApprovalCard optimistic rollback (FR-045,X-1)", () => {
  it("rolls back the optimistic Executing state and surfaces the error when approve fails", async () => {
    server.use(http.post("/api/actions/:id/approve", () => new HttpResponse("action already approved", { status: 409 })));

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(screen.getByText(/submitting approval/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already approved/i));
    expect(screen.queryByText(/submitting approval/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/executing/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
  });

  it("allows retrying approve after a rolled-back failure", async () => {
    let attempt = 0;
    server.use(
      http.post("/api/actions/:id/approve", () => {
        attempt += 1;
        if (attempt === 1) return new HttpResponse("transient error", { status: 500 });
        return HttpResponse.json({ executedActionId: "exec-a3", status: "RUNNING" }, { status: 202 });
      }),
      http.get("/api/actions/:id/execution", () =>
        HttpResponse.json({ status: "RUNNING", errorMessage: null, startedAt: new Date().toISOString(), finishedAt: null }),
      ),
    );

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/transient error/i));

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(screen.getByText(/^executing/i)).toBeInTheDocument());
    expect(attempt).toBe(2);
  });

  it("rolls back to the reject form and surfaces the error when reject fails", async () => {
    server.use(http.post("/api/actions/:id/reject", () => new HttpResponse("action already resolved", { status: 409 })));

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Not needed" } });
    fireEvent.click(screen.getByRole("button", { name: /submit rejection/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already resolved/i));
    expect(screen.getByRole("button", { name: /submit rejection/i })).toBeInTheDocument();
  });
});
