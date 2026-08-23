import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FeedbackForm } from "./FeedbackForm";
import { OperatorProvider } from "../../state/OperatorContext";
import type { FeedbackRecord } from "../../api/feedback";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.setItem("incident-tracker:operator-name", "a.reyes");
});

const existing: FeedbackRecord[] = [
  {
    id: "fb-1",
    feedbackType: "APPROVED",
    comments: "Classification looked right.",
    correctedCategory: null,
    correctedPriority: null,
    correctedResolution: null,
    createdBy: "m.tan",
    createdAt: "2026-08-10T09:00:00Z",
  },
];

function renderForm(existingFeedback: FeedbackRecord[] = existing) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OperatorProvider>
        <FeedbackForm incidentId="inc-1042" existingFeedback={existingFeedback} />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

describe("FeedbackForm", () => {
  it("lists existing feedback above the form (FR-073)", () => {
    renderForm();
    expect(screen.getByText("Classification looked right.")).toBeInTheDocument();
    expect(screen.getByText("m.tan")).toBeInTheDocument();
  });

  it("requires a feedback type before submitting", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/comments/i), { target: { value: "Looked fine" } });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    expect(await screen.findByText(/feedback type is required/i)).toBeInTheDocument();
  });

  it("requires comments before submitting", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/feedback type/i), { target: { value: "APPROVED" } });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    expect(await screen.findByText(/comments are required/i)).toBeInTheDocument();
  });

  it("accepts optional corrected category, priority, and resolution", async () => {
    const captured: { body: unknown } = { body: null };
    server.use(
      http.post("/api/incidents/:id/feedback", async ({ request }) => {
        captured.body = await request.json();
        return HttpResponse.json(
          { id: "fb-new", feedbackType: "CORRECTED", comments: "Priority was too low", correctedCategory: null, correctedPriority: "P1", correctedResolution: null, createdBy: "a.reyes", createdAt: "2026-08-17T12:00:00Z" },
          { status: 201 },
        );
      }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/feedback type/i), { target: { value: "CORRECTED" } });
    fireEvent.change(screen.getByLabelText(/comments/i), { target: { value: "Priority was too low" } });
    fireEvent.change(screen.getByLabelText(/corrected priority/i), { target: { value: "P1" } });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    await waitFor(() =>
      expect(captured.body).toEqual({
        actor: "a.reyes",
        feedbackType: "CORRECTED",
        comments: "Priority was too low",
        correctedPriority: "P1",
      }),
    );
  });

  it("prepends the new submission to the existing feedback list and clears the form", async () => {
    server.use(
      http.post("/api/incidents/:id/feedback", () =>
        HttpResponse.json(
          { id: "fb-new", feedbackType: "APPROVED", comments: "All good", correctedCategory: null, correctedPriority: null, correctedResolution: null, createdBy: "a.reyes", createdAt: "2026-08-17T12:00:00Z" },
          { status: 201 },
        ),
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/feedback type/i), { target: { value: "APPROVED" } });
    fireEvent.change(screen.getByLabelText(/comments/i), { target: { value: "All good" } });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    expect(await screen.findByText("All good")).toBeInTheDocument();
    expect(screen.getByText("Classification looked right.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>(/comments/i).value).toBe(""));
  });
});
