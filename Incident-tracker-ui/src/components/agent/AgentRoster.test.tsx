import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentRoster } from "./AgentRoster";
import type { AgentSummary, RosterData } from "../../api/agents/roster";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "agent-1",
    name: "Decision Agent",
    description: "Proposes remediation actions.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: null,
    hasModule: true,
    invokedBy: "pipeline",
    detail: "Third step of triage.",
    runs: {
      total: 13, successful: 13, failed: 0,
      successRatePercent: 100, avgConfidence: 0.61, avgLatencyMs: 4864,
    },
    ...overrides,
  };
}

function renderRoster(agents: AgentSummary[]) {
  const roster: RosterData = {
    agents,
    autonomyEnabled: false,
    autonomyLevels: ["observe", "suggest", "act_with_approval", "act_autonomously"],
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AgentRoster roster={roster} selectedId="agent-1" onSelect={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("AgentRoster", () => {
  // The whole reason this panel exists: eight registered agents are not eight
  // running agents, and a roster showing them as equal peers would be the one
  // lie on the page.
  // Scoped to the row: the panel's footnote explains what the badge means and
  // repeats the words, which is intentional and not what these assert.
  function rowBadge(name: string) {
    const row = screen.getByText(name).closest("li");
    return row?.textContent ?? "";
  }

  it("says when an agent has no module rather than showing it as healthy", () => {
    renderRoster([agent({ name: "Validation Agent", hasModule: false, invokedBy: "nothing" })]);

    expect(rowBadge("Validation Agent")).toMatch(/no module/i);
  });

  it("says when a module exists but nothing calls it", () => {
    renderRoster([
      agent({ name: "Knowledge Generation Agent", hasModule: true, invokedBy: "nothing" }),
    ]);

    expect(rowBadge("Knowledge Generation Agent")).toMatch(/not called/i);
  });

  it("counts only the reachable ones in the header", () => {
    renderRoster([
      agent({ id: "a", name: "Decision Agent" }),
      agent({ id: "b", name: "Validation Agent", hasModule: false, invokedBy: "nothing" }),
      agent({ id: "c", name: "Knowledge Generation Agent", invokedBy: "nothing" }),
    ]);

    expect(screen.getByText("1 of 3 reachable")).toBeInTheDocument();
  });

  it("does not badge an agent that something actually calls", () => {
    renderRoster([agent()]);

    expect(rowBadge("Decision Agent")).not.toMatch(/no module|not called/i);
    expect(rowBadge("Decision Agent")).toMatch(/in the pipeline/i);
  });

  it("distinguishes never-run from a zero success rate", () => {
    renderRoster([
      agent({
        runs: { total: 0, successful: 0, failed: 0, successRatePercent: null,
                avgConfidence: null, avgLatencyMs: null },
      }),
    ]);

    // "0% ok" on an agent that has never run would report a failure that never
    // happened.
    expect(screen.queryByText(/0% ok/)).not.toBeInTheDocument();
    expect(screen.getByText(/0 runs/)).toBeInTheDocument();
  });

  it("rolls the switch back and says why when the server refuses", async () => {
    server.use(
      http.patch("/api/agents/:id", () =>
        new HttpResponse("that agent is pinned by policy", { status: 400 }),
      ),
    );
    renderRoster([agent()]);
    const toggle = screen.getByRole("switch", { name: /Decision Agent enabled/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    // A switch that snaps back silently leaves the operator believing the
    // opposite of what the server stored.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/pinned by policy/i));
    expect(screen.getByRole("switch", { name: /Decision Agent enabled/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("keeps the flip when the server accepts it", async () => {
    server.use(http.patch("/api/agents/:id", () => HttpResponse.json(agent({ isActive: false }))));
    renderRoster([agent()]);

    fireEvent.click(screen.getByRole("switch", { name: /Decision Agent enabled/i }));

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /Decision Agent enabled/i })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
