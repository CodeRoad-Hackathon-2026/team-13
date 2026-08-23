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
  window.localStorage.clear();
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
  topMatches: [
    {
      documentType: "RUNBOOK",
      title: "Token cleanup runbook",
      score: 0.8,
      sourceUrl: "https://runbooks.internal/tokens",
    },
  ],
  proposedAt: "2026-08-17T11:00:00Z",
  proposedByAgent: "Remediation Planner",
};

function renderCard(cardOverride: PendingApprovalCard = card) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OperatorProvider>
        <ul>
          <ApprovalCard card={cardOverride} />
        </ul>
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

describe("ApprovalCard", () => {
  it("renders an unmissable risk badge with a text label (FR-033,AR-1)", () => {
    renderCard();
    expect(screen.getByText(/low risk/i)).toBeInTheDocument();
  });

  it("renders a confidence bar with its numeric value and a low-confidence caption below threshold (FR-034,AR-2)", () => {
    renderCard();
    expect(screen.getByText("0.62")).toBeInTheDocument();
    expect(screen.getByText(/low confidence/i)).toBeInTheDocument();
  });

  // FR-035/AR-3/P-4: parameters now live inside the Evidence panel, which is closed on mount —
  // so nothing is rendered and no request fires until the operator opens it.
  it("collapses parameters by default and fetches them when Evidence is opened (FR-035,AR-3)", async () => {
    server.use(
      http.get("/api/actions/:id/parameters", () =>
        HttpResponse.json({ parameters: { statement: "SELECT 1" } }),
      ),
    );
    renderCard();

    expect(screen.queryByText(/select/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /evidence/i }));

    expect(await screen.findByText(/select/i)).toBeInTheDocument();
  });

  it("collapses the evidence by default and expands to show the matches (FR-036,AR-4)", () => {
    renderCard();

    expect(screen.queryByText("Token cleanup runbook")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /evidence/i }));

    expect(screen.getByText("Token cleanup runbook")).toBeInTheDocument();
  });

  it("approves a LOW-risk action in a single click, with no confirmation modal (FR-037)", async () => {
    window.localStorage.setItem("incident-tracker:operator-name", "a.reyes");
    const captured: { body: unknown } = { body: null };
    server.use(
      http.post("/api/actions/:id/approve", async ({ request }) => {
        captured.body = await request.json();
        return HttpResponse.json(
          { executedActionId: "exec-a3", status: "RUNNING" },
          { status: 202 },
        );
      }),
      http.get("/api/actions/:id/execution", () =>
        HttpResponse.json({
          status: "RUNNING",
          errorMessage: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        }),
      ),
    );

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(captured.body).toEqual({ actor: "a.reyes" }));
    await waitFor(() => expect(screen.getByText(/executing/i)).toBeInTheDocument());
  });

  it("requires a reason to reject, and writes feedback on submit (FR-038,FR-039)", async () => {
    window.localStorage.setItem("incident-tracker:operator-name", "a.reyes");
    const captured: { body: unknown } = { body: null };
    server.use(
      http.post("/api/actions/:id/reject", async ({ request }) => {
        captured.body = await request.json();
        return HttpResponse.json({
          status: "REJECTED",
          approvedBy: "a.reyes",
          approvedAt: new Date().toISOString(),
        });
      }),
    );

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), {
      target: { value: "No longer needed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit rejection/i }));

    await waitFor(() =>
      expect(captured.body).toEqual({ actor: "a.reyes", reason: "No longer needed" }),
    );
  });
});
