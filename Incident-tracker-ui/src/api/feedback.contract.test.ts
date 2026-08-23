import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { submitFeedback } from "./feedback";
import { ApiError } from "./client";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("submitFeedback contract", () => {
  it("posts actor, feedbackType, comments, and optional corrections (FR-073)", async () => {
    const captured: { body: unknown } = { body: null };
    server.use(
      http.post("/api/incidents/:id/feedback", async ({ request }) => {
        captured.body = await request.json();
        return HttpResponse.json(
          {
            id: "fb-new",
            feedbackType: "CORRECTED",
            comments: "Priority was too low",
            correctedCategory: null,
            correctedPriority: "P1",
            correctedResolution: null,
            createdBy: "a.reyes",
            createdAt: "2026-08-17T12:00:00Z",
          },
          { status: 201 },
        );
      }),
    );

    const result = await submitFeedback("inc-1042", {
      actor: "a.reyes",
      feedbackType: "CORRECTED",
      comments: "Priority was too low",
      correctedPriority: "P1",
    });

    expect(captured.body).toEqual({
      actor: "a.reyes",
      feedbackType: "CORRECTED",
      comments: "Priority was too low",
      correctedPriority: "P1",
    });
    expect(result.id).toBe("fb-new");
    expect(result.createdBy).toBe("a.reyes");
  });

  it("returns the new row in the same shape as the drawer's own feedback array, for prepending without a refetch", async () => {
    server.use(
      http.post("/api/incidents/:id/feedback", () =>
        HttpResponse.json(
          {
            id: "fb-new",
            feedbackType: "APPROVED",
            comments: "Looked right",
            correctedCategory: null,
            correctedPriority: null,
            correctedResolution: null,
            createdBy: "a.reyes",
            createdAt: "2026-08-17T12:00:00Z",
          },
          { status: 201 },
        ),
      ),
    );

    const result = await submitFeedback("inc-1042", { actor: "a.reyes", feedbackType: "APPROVED", comments: "Looked right" });

    expect(result).toEqual({
      id: "fb-new",
      feedbackType: "APPROVED",
      comments: "Looked right",
      correctedCategory: null,
      correctedPriority: null,
      correctedResolution: null,
      createdBy: "a.reyes",
      createdAt: "2026-08-17T12:00:00Z",
    });
  });

  it("surfaces a 404 when the incident no longer exists", async () => {
    server.use(http.post("/api/incidents/:id/feedback", () => new HttpResponse("Incident not found", { status: 404 })));

    const error = await submitFeedback("inc-gone", { actor: "a.reyes", feedbackType: "APPROVED", comments: "x" }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(404);
  });
});
