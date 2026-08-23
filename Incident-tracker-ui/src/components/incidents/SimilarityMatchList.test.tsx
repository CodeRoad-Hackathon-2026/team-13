import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SimilarityMatchList } from "./SimilarityMatchList";
import type { IncidentDetail } from "../../api/incidents/detail";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeMatch(
  overrides: Partial<IncidentDetail["similarityMatches"][number]>,
): IncidentDetail["similarityMatches"][number] {
  return {
    id: "match-1",
    documentType: "RUNBOOK",
    title: "Connection pool exhaustion runbook",
    score: 0.92,
    summarySnippet: "Restart the pool and check for leaked connections.",
    sourceUrl: "https://runbooks.internal/db-pool",
    ...overrides,
  };
}

function renderList(matches: IncidentDetail["similarityMatches"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SimilarityMatchList incidentId="inc-1" matches={matches} />
    </QueryClientProvider>,
  );
}

describe("SimilarityMatchList", () => {
  it("lists matches with document-type badge, title, score bar, snippet and source link (FR-066)", () => {
    renderList([makeMatch({})]);
    expect(screen.getByText("RUNBOOK")).toBeInTheDocument();
    expect(screen.getByText("Connection pool exhaustion runbook")).toBeInTheDocument();
    expect(screen.getByText(/0\.92/)).toBeInTheDocument();
    expect(screen.getByText(/restart the pool/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view source/i });
    expect(link).toHaveAttribute("href", "https://runbooks.internal/db-pool");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("sorts descending by score", () => {
    const matches = [
      makeMatch({ id: "a", title: "Lower score", score: 0.5 }),
      makeMatch({ id: "b", title: "Higher score", score: 0.9 }),
    ];
    renderList(matches);
    const titles = screen.getAllByRole("heading", { level: 3 }).map((el) => el.textContent);
    expect(titles).toEqual(["Higher score", "Lower score"]);
  });

  it('offers a "show all" control that lazily fetches the uncapped list, not a client-side reslice (FR-066/P-4)', async () => {
    const initialFive = Array.from({ length: 5 }, (_, i) => makeMatch({ id: `m${i}`, title: `Match ${i}`, score: 1 - i / 10 }));
    const capture: { called: boolean } = { called: false };
    server.use(
      http.get("/api/incidents/inc-1/similarity-matches", () => {
        capture.called = true;
        const all = Array.from({ length: 8 }, (_, i) => makeMatch({ id: `m${i}`, title: `Match ${i}`, score: 1 - i / 10 }));
        return HttpResponse.json({ matches: all });
      }),
    );
    renderList(initialFive);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(5);
    expect(capture.called).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    await waitFor(() => expect(capture.called).toBe(true));
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(8));
  });

  it('does not show a "show all" control when there are fewer than five matches', () => {
    renderList([makeMatch({})]);
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no matches", () => {
    renderList([]);
    expect(screen.getByText(/no similar incidents or runbooks/i)).toBeInTheDocument();
  });
});
