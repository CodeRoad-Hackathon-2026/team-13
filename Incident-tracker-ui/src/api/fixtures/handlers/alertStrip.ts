import { http, HttpResponse } from "msw";
import { RECOMMENDED_ACTIONS, INCIDENTS, AUTO_EXECUTED_COUNT_IN_RANGE } from "../seededDataset";
import type { AlertStripData } from "../../dashboard/alertStrip";

export const alertStripHandlers = [
  http.get("/api/dashboard/alert-strip", () => {
    const p1Active = INCIDENTS.filter(
      (i) => i.priority === "P1" && !["RESOLVED", "CLOSED"].includes(i.status),
    ).length;
    const pending = RECOMMENDED_ACTIONS.filter((a) => a.status === "PROPOSED" && a.approvalRequired);
    const body: AlertStripData = {
      p1Active,
      awaitingApproval: pending.length,
      oldestPendingAgeMinutes: pending.length > 0 ? 34 : null,
      autoExecutedCountInRange: AUTO_EXECUTED_COUNT_IN_RANGE,
    };
    return HttpResponse.json(body);
  }),
];
