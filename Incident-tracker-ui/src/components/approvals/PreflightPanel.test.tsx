import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PreflightPanel } from "./PreflightPanel";
import type { PreflightData } from "../../api/approvals/preflight";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mock(body: PreflightData | number) {
  server.use(
    http.get("/api/actions/:id/preflight", () =>
      typeof body === "number"
        ? new HttpResponse("orchestrator unavailable", { status: body })
        : HttpResponse.json(body),
    ),
  );
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PreflightPanel actionId="act-1" />
    </QueryClientProvider>,
  );
}

const blocked: PreflightData = {
  verdict: "blocked",
  summary: "1 check would stop this before anything happened.",
  checks: [
    {
      key: "executor",
      label: "Executor registered",
      status: "fail",
      detail: "no executor is registered for KUBERNETES",
    },
  ],
};

describe("PreflightPanel", () => {
  it("leads with the verdict in words, not with a list to summarise", async () => {
    mock(blocked);
    renderPanel();

    expect(await screen.findByText(/would stop this before anything happened/i)).toBeInTheDocument();
  });

  it("names the guard and why it would stop", async () => {
    mock(blocked);
    renderPanel();

    expect(await screen.findByText("Executor registered")).toBeInTheDocument();
    expect(screen.getByText(/no executor is registered for KUBERNETES/i)).toBeInTheDocument();
  });

  // AR-1/A11Y-1: never colour alone. Red-green in particular is the one pair colour vision cannot
  // separate, and pass/fail is exactly that pair.
  it("carries a status word for a reader who cannot use the colour", async () => {
    mock(blocked);
    renderPanel();
    await screen.findByText("Executor registered");

    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("distinguishes a dry run from a real one, because Approve means something else in each", async () => {
    mock({
      verdict: "dry_run",
      summary: "This would run as a dry run — committed locally, nothing pushed.",
      checks: [
        {
          key: "push",
          label: "Push enabled",
          status: "pass",
          detail: "dry run — stopped before push",
        },
      ],
    });
    renderPanel();

    expect(await screen.findByText(/nothing pushed/i)).toBeInTheDocument();
  });

  // The panel failing must not read as "all clear". An operator who cannot see the checks is
  // deciding without them, and should be told that rather than shown an empty list.
  it("says the checks are unavailable rather than implying they passed", async () => {
    mock(503);
    renderPanel();

    expect(await screen.findByText(/pre-flight checks are unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/deciding without this/i)).toBeInTheDocument();
  });
});
