import { http, HttpResponse } from "msw";
import { VOLUME_SERIES, BREAKDOWN_BY_PRIORITY, BREAKDOWN_BY_CATEGORY, BREAKDOWN_BY_SERVICE } from "../seededDataset";
import type { BreakdownsData } from "../../dashboard/breakdowns";

// The seeded fixtures already carry exactly this shape (top-6+"Other" for category, top-5 for
// service, server-pre-sorted) — no additional computation needed here.
export const dashboardBreakdownsHandlers = [
  http.get("/api/dashboard/breakdowns", () => {
    const body: BreakdownsData = {
      volume: VOLUME_SERIES,
      byPriority: BREAKDOWN_BY_PRIORITY,
      byCategory: BREAKDOWN_BY_CATEGORY,
      byService: BREAKDOWN_BY_SERVICE,
    };
    return HttpResponse.json(body);
  }),
];
