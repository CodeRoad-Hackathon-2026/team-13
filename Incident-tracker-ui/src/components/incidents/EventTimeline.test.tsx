import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EventTimeline } from "./EventTimeline";
import type { IncidentDetail } from "../../api/incidents/detail";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const createdAt = "2026-08-16T11:42:00Z";

const events: IncidentDetail["events"] = [
  {
    id: "ev-1",
    eventType: "INCIDENT_CREATED",
    description: "Incident created from PagerDuty",
    createdBy: "system",
    createdAt: "2026-08-16T11:42:00Z",
    isAgentEvent: false,
    isFailureEvent: false,
  },
  {
    id: "ev-2",
    eventType: "VALIDATION_FAILED",
    description: "Parameter validation failed",
    createdBy: "classifier-agent",
    createdAt: "2026-08-16T11:43:30Z",
    isAgentEvent: true,
    isFailureEvent: true,
  },
];

function renderTimeline(eventList = events) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EventTimeline incidentId="inc-1" incidentCreatedAt={createdAt} events={eventList} />
    </QueryClientProvider>,
  );
}

describe("EventTimeline", () => {
  it("renders a chronological timeline with description, actor and cumulative elapsed time (FR-069/072)", () => {
    renderTimeline();
    expect(screen.getByText("Incident created from PagerDuty")).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("+0s")).toBeInTheDocument();
    expect(screen.getByText("+1m 30s")).toBeInTheDocument();
  });

  it("flags failure events with a text label (FR-071/TL-2/A11Y-1)", () => {
    renderTimeline();
    const failureItem = screen.getByText("Parameter validation failed").closest("li");
    expect(failureItem).toHaveAttribute("data-failure", "true");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it('offers an "agent events only" filter that re-fetches server-side (TL-1)', async () => {
    const capture: { agentOnly: string | null } = { agentOnly: null };
    server.use(
      http.get("/api/incidents/inc-1/events", ({ request }) => {
        const url = new URL(request.url);
        capture.agentOnly = url.searchParams.get("agentOnly");
        return HttpResponse.json({ events: [events[1]] });
      }),
    );
    renderTimeline();
    fireEvent.click(screen.getByRole("checkbox", { name: /agent events only/i }));
    await waitFor(() => expect(capture.agentOnly).toBe("true"));
    expect(await screen.findByText("Parameter validation failed")).toBeInTheDocument();
    expect(screen.queryByText("Incident created from PagerDuty")).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no events", () => {
    renderTimeline([]);
    expect(screen.getByText(/no events recorded/i)).toBeInTheDocument();
  });
});
