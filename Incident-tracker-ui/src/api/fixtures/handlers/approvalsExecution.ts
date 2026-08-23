import { http, HttpResponse } from "msw";
import { EXECUTED_ACTIONS, SIMULATED_EXECUTION_MS } from "../seededDataset";
import type { ExecutionStatus } from "../../approvals/execution";

// contracts/approvals-endpoints.md: :id is the RecommendedAction id, matching the card's own key
// (FR-042) — looked up here via recommendedActionId, never the ExecutedAction's own id.
export const approvalsExecutionHandlers = [
  http.get("/api/actions/:id/execution", ({ params }) => {
    const execution = EXECUTED_ACTIONS.find((e) => e.recommendedActionId === params.id);
    if (!execution) return new HttpResponse("No execution found for this action", { status: 404 });

    if (execution.status !== "RUNNING") {
      const body: ExecutionStatus = {
        status: execution.status,
        errorMessage: execution.errorMessage,
        startedAt: execution.startedAt,
        finishedAt: execution.finishedAt,
      };
      return HttpResponse.json(body);
    }

    // Demo simulation: resolves to SUCCESS once SIMULATED_EXECUTION_MS has elapsed since approval,
    // mutating the shared fixture so every subsequent poll (any card, any tab) agrees.
    const elapsed = Date.now() - new Date(execution.startedAt).getTime();
    if (elapsed >= SIMULATED_EXECUTION_MS) {
      execution.status = "SUCCESS";
      execution.finishedAt = new Date().toISOString();
    }

    const body: ExecutionStatus = {
      status: execution.status,
      errorMessage: execution.errorMessage,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
    };
    return HttpResponse.json(body);
  }),
];
