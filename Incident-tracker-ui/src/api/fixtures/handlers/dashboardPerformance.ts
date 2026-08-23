import { http, HttpResponse } from "msw";
import type { PerformanceData } from "../../dashboard/performance";
import type { FunnelStage } from "../../../domain/funnel";
import { FUNNEL_STAGES } from "../seededDataset";

// FUNNEL_STAGES already carries the PRD's own worked funnel example (142/98/87/79/71) — an
// aggregate spanning a wider history than the handful of incidents kept for table/drawer
// fixtures, same convention as the alert strip's autoExecutedCountInRange. validatedResolved is
// null throughout: no validation record exists in the schema (data-model.md gap, spec.md
// Assumption 5), so it renders as explicitly unavailable rather than as a fabricated zero.
const PERFORMANCE_DATA: PerformanceData = {
  tiles: {
    automationRatePercent: { value: 62, deltaVsPrevious: 3 },
    medianTimeToResolveMinutes: { value: 125, averageMinutes: 210, deltaVsPrevious: -10 },
    knownIncidentHitRate: { value: 71, deltaVsPrevious: 2 },
  },
  funnel: {
    stages: FUNNEL_STAGES as FunnelStage[],
    automationRate: { fullyAutomatedPercent: 34, humanAssistedPercent: 28 },
  },
  outcomes: {
    counts: { success: 71, failed: 6, rolledBack: 3, running: 2 },
    successRatePercent: 87,
    medianDurationMinutes: 4,
    byActionType: [
      { actionType: "SQL", success: 20, failed: 2, rolledBack: 1, running: 0, medianDurationMinutes: 3 },
      { actionType: "LAMBDA", success: 25, failed: 1, rolledBack: 1, running: 1, medianDurationMinutes: 4 },
      { actionType: "API", success: 15, failed: 2, rolledBack: 1, running: 1, medianDurationMinutes: 5 },
      { actionType: "GITHUB_PR", success: 6, failed: 1, rolledBack: 0, running: 0, medianDurationMinutes: 6 },
      { actionType: "KUBERNETES", success: 5, failed: 0, rolledBack: 0, running: 0, medianDurationMinutes: 7 },
    ],
    recentFailures: [
      {
        executedActionId: "exec-fail-1",
        incidentId: "inc-1042",
        actionType: "LAMBDA",
        truncatedErrorMessage: "Timed out waiting for pool restart to confirm…",
      },
      {
        executedActionId: "exec-fail-2",
        incidentId: "inc-1038",
        actionType: "SQL",
        truncatedErrorMessage: "duplicate key value violates unique constraint…",
      },
      {
        executedActionId: "exec-fail-3",
        incidentId: "inc-1041",
        actionType: "API",
        truncatedErrorMessage: "edge purge API returned 503 after 3 retries…",
      },
    ],
  },
};

export const dashboardPerformanceHandlers = [
  http.get("/api/dashboard/performance", () => HttpResponse.json(PERFORMANCE_DATA)),
];
