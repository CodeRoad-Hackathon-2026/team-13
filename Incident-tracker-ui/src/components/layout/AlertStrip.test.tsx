import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AlertStrip } from "./AlertStrip";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mockAlertStrip(body: object) {
  server.use(http.get("/api/dashboard/alert-strip", () => HttpResponse.json(body)));
}

function renderWithClient(initialSearch = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.replaceState(null, "", initialSearch ? `/?${initialSearch}` : "/");
  render(
    <QueryClientProvider client={queryClient}>
      <AlertStrip />
    </QueryClientProvider>,
  );
}

// role="status" matches the loading render too, so waiting on that role alone can resolve
// before data has actually loaded. Wait for the loading state to clear instead.
async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.getByRole("status")).not.toHaveAttribute("data-severity", "loading");
  });
  return screen.getByRole("status");
}

describe("AlertStrip", () => {
  it('renders the "hot" state when at least one P1 is active', async () => {
    mockAlertStrip({ p1Active: 2, awaitingApproval: 3, oldestPendingAgeMinutes: 12, autoExecutedCountInRange: 14 });
    renderWithClient();
    const strip = await waitForLoaded();
    expect(strip).toHaveAttribute("data-severity", "hot");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it('renders the "warm" state when approvals are pending but no P1 is active', async () => {
    mockAlertStrip({ p1Active: 0, awaitingApproval: 1, oldestPendingAgeMinutes: 5, autoExecutedCountInRange: 14 });
    renderWithClient();
    const strip = await waitForLoaded();
    expect(strip).toHaveAttribute("data-severity", "warm");
  });

  it("renders a calm resting message instead of disappearing when both counts are zero", async () => {
    mockAlertStrip({ p1Active: 0, awaitingApproval: 0, oldestPendingAgeMinutes: null, autoExecutedCountInRange: 14 });
    renderWithClient();
    await waitForLoaded();
    expect(screen.getByText(/no critical incidents/i)).toBeInTheDocument();
    expect(screen.getByText(/14/)).toBeInTheDocument();
  });

  it('uses aria-live="polite", never "assertive"', async () => {
    mockAlertStrip({ p1Active: 1, awaitingApproval: 0, oldestPendingAgeMinutes: null, autoExecutedCountInRange: 0 });
    renderWithClient();
    const strip = await waitForLoaded();
    expect(strip).toHaveAttribute("aria-live", "polite");
  });

  it("clicking the P1 count switches to the now tab, filters to active P1, and never changes the strip's own counts", async () => {
    mockAlertStrip({ p1Active: 2, awaitingApproval: 1, oldestPendingAgeMinutes: 5, autoExecutedCountInRange: 0 });
    renderWithClient("tab=performance");
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /p1 active/i }));
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      // "now" is the default and is omitted from the URL entirely, so its absence here
      // (after starting on "performance") is what confirms the switch happened.
      expect(params.get("tab")).toBeNull();
      expect(params.get("filterKey")).toBe("p1Active");
    });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("clicking awaiting-approval switches to the now tab without applying an incident filter", async () => {
    mockAlertStrip({ p1Active: 0, awaitingApproval: 4, oldestPendingAgeMinutes: 8, autoExecutedCountInRange: 0 });
    renderWithClient("tab=performance");
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /awaiting approval/i }));
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("tab")).toBeNull();
    });
  });
});
