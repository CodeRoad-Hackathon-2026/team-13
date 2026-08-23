import { http, HttpResponse } from "msw";
import { INCIDENTS, DEVELOPER_FEEDBACK } from "../seededDataset";
import type { SubmitFeedbackRequest, FeedbackRecord } from "../../feedback";

// FR-073: writes one DeveloperFeedback row, which becomes one more data point in the next
// feedback-impact read (contracts/feedback-endpoint.md) — this handler does not itself recompute
// or return that figure.
export const feedbackHandlers = [
  http.post("/api/incidents/:id/feedback", async ({ params, request }) => {
    const incident = INCIDENTS.find((i) => i.id === params.id);
    if (!incident) return new HttpResponse("Incident not found", { status: 404 });

    const body = (await request.json()) as SubmitFeedbackRequest;
    const now = new Date().toISOString();

    DEVELOPER_FEEDBACK.push({
      id: `fb-${DEVELOPER_FEEDBACK.length + 1}`,
      incidentId: incident.id,
      recommendedActionId: null,
      feedbackType: body.feedbackType,
      comments: body.comments,
      correctedCategory: body.correctedCategory ?? null,
      correctedPriority: body.correctedPriority ?? null,
      correctedResolution: body.correctedResolution ?? null,
      createdBy: body.actor,
      createdAt: now,
    });

    const response: FeedbackRecord = {
      id: `fb-${DEVELOPER_FEEDBACK.length}`,
      feedbackType: body.feedbackType,
      comments: body.comments,
      correctedCategory: body.correctedCategory ?? null,
      correctedPriority: body.correctedPriority ?? null,
      correctedResolution: body.correctedResolution ?? null,
      createdBy: body.actor,
      createdAt: now,
    };

    return HttpResponse.json(response, { status: 201 });
  }),
];
