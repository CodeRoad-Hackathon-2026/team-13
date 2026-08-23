import { http, HttpResponse } from "msw";
import { RECOMMENDED_ACTIONS, EXECUTED_ACTIONS, DEVELOPER_FEEDBACK } from "../seededDataset";
import type { ApproveActionResponse } from "../../approvals/approve";
import type { RejectActionResponse } from "../../approvals/reject";

// contracts/approvals-endpoints.md: mutates the in-memory seeded dataset directly, so a subsequent
// GET /pending reflects the new state and GET /execution can report progress for what this creates.
// Resets on page reload/re-import — acceptable for a hackathon MVP with no real backend.
export const approvalsActionsHandlers = [
  http.post("/api/actions/:id/approve", async ({ params, request }) => {
    const action = RECOMMENDED_ACTIONS.find((a) => a.id === params.id);
    if (!action) return new HttpResponse("Action not found", { status: 404 });
    if (action.status !== "PROPOSED") {
      return new HttpResponse("Action is no longer pending approval", { status: 409 });
    }

    const body = (await request.json()) as { actor: string; confirmedHighRisk?: true };
    if (action.riskLevel === "HIGH" && body.confirmedHighRisk !== true) {
      return new HttpResponse("confirmedHighRisk is required for a HIGH-risk action", { status: 400 });
    }

    const now = new Date();
    action.status = "APPROVED";
    action.approvedBy = body.actor;
    action.approvedAt = now.toISOString();

    const executedActionId = `exec-${action.id}`;
    EXECUTED_ACTIONS.push({
      id: executedActionId,
      recommendedActionId: action.id,
      status: "RUNNING",
      startedAt: now.toISOString(),
      finishedAt: null,
      errorMessage: null,
    });

    const response: ApproveActionResponse = { executedActionId, status: "RUNNING" };
    return HttpResponse.json(response, { status: 202 });
  }),

  http.post("/api/actions/:id/reject", async ({ params, request }) => {
    const action = RECOMMENDED_ACTIONS.find((a) => a.id === params.id);
    if (!action) return new HttpResponse("Action not found", { status: 404 });
    if (action.status !== "PROPOSED") {
      return new HttpResponse("Action is no longer pending approval", { status: 409 });
    }

    const body = (await request.json()) as {
      actor: string;
      reason: string;
      correctedCategory?: string;
      correctedPriority?: "P1" | "P2" | "P3" | "P4";
    };
    if (!body.reason || body.reason.trim().length === 0) {
      return new HttpResponse("reason is required", { status: 400 });
    }

    const now = new Date();
    action.status = "REJECTED";
    action.approvedBy = body.actor;
    action.approvedAt = now.toISOString();
    action.rejectionReason = body.reason;

    // FR-039/AR-6: the reason has no dedicated column yet (data-model.md gap note) — it lands on
    // this DeveloperFeedback row's `comments` instead.
    DEVELOPER_FEEDBACK.push({
      id: `fb-reject-${action.id}-${DEVELOPER_FEEDBACK.length + 1}`,
      incidentId: action.incidentId,
      recommendedActionId: action.id,
      feedbackType: "REJECTED",
      comments: body.reason,
      correctedCategory: body.correctedCategory ?? null,
      correctedPriority: body.correctedPriority ?? null,
      correctedResolution: null,
      createdBy: body.actor,
      createdAt: now.toISOString(),
    });

    const response: RejectActionResponse = { status: "REJECTED", approvedBy: body.actor, approvedAt: now.toISOString() };
    return HttpResponse.json(response);
  }),
];
