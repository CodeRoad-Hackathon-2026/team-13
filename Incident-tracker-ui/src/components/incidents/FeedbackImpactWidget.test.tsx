import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FeedbackImpactWidget } from "./FeedbackImpactWidget";
import { OperatorProvider } from "../../state/OperatorContext";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.setItem("incident-tracker:operator-name", "a.reyes");
});

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OperatorProvider>
        <FeedbackImpactWidget />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

function mockImpact(body: object) {
  server.use(http.get("/api/feedback/impact", () => HttpResponse.json(body)));
}

describe("FeedbackImpactWidget", () => {
  it("shows accuracy, prior value, personal count, and team-quarter total when not suppressed (FI-1,FI-2,FR-074)", async () => {
    mockImpact({
      personal: { accuracyPercent: 84, previousAccuracyPercent: 71, correctionCount: 12, lastCorrectionAt: "2026-08-14T09:00:00Z" },
      team: { correctionCount: 61, engineerCount: 4, quarterLabel: "Q3 2026" },
      suppressed: false,
    });
    renderWidget();

    expect(await screen.findByText(/84%/)).toBeInTheDocument();
    expect(screen.getByText(/71%/)).toBeInTheDocument();
    expect(screen.getByText(/12 corrections submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/61 corrections this quarter/i)).toBeInTheDocument();
    expect(screen.getByText(/4 engineers/i)).toBeInTheDocument();
  });

  it("renders nothing at all when suppressed — not a caveated version (FI-4,FR-077,§11.20)", async () => {
    mockImpact({
      personal: { accuracyPercent: 100, previousAccuracyPercent: 100, correctionCount: 2, lastCorrectionAt: null },
      team: { correctionCount: 4, engineerCount: 1, quarterLabel: "Q3 2026" },
      suppressed: true,
    });
    renderWidget();

    // Give the query a moment to resolve, then assert nothing rendered at all.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.body.textContent).toBe("");
  });

  it("never frames a decline as the user's failure — attributes it to the model or the period (FI-3,FR-078)", async () => {
    mockImpact({
      personal: { accuracyPercent: 62, previousAccuracyPercent: 71, correctionCount: 12, lastCorrectionAt: "2026-08-14T09:00:00Z" },
      team: { correctionCount: 61, engineerCount: 4, quarterLabel: "Q3 2026" },
      suppressed: false,
    });
    renderWidget();

    expect(await screen.findByText(/62%/)).toBeInTheDocument();
    const widget = screen.getByLabelText(/feedback impact/i);
    expect(widget).toHaveTextContent(/model or (this|the) period/i);
    expect(widget.textContent).not.toMatch(/your feedback (caused|led to|is responsible)/i);
    expect(widget.textContent?.toLowerCase()).not.toContain("you caused");
  });

  it("never renders any ranking, badge, streak, or leaderboard element (FI-5,FR-079,§13)", async () => {
    mockImpact({
      personal: { accuracyPercent: 84, previousAccuracyPercent: 71, correctionCount: 12, lastCorrectionAt: "2026-08-14T09:00:00Z" },
      team: { correctionCount: 61, engineerCount: 4, quarterLabel: "Q3 2026" },
      suppressed: false,
    });
    renderWidget();

    await screen.findByText(/84%/);
    expect(screen.queryByText(/rank|badge|streak|leaderboard|score/i)).not.toBeInTheDocument();
  });
});
