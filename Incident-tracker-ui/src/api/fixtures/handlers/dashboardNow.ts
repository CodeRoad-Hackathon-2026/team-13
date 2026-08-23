import { http, HttpResponse } from "msw";
import { INCIDENTS } from "../seededDataset";
import type { NowTilesData } from "../../dashboard/now";

const CLOSED_STATUSES = ["RESOLVED", "CLOSED"];
const isOpen = (status: string) => !CLOSED_STATUSES.includes(status);

export const dashboardNowHandlers = [
  http.get("/api/dashboard/now", () => {
    const open = INCIDENTS.filter((i) => isOpen(i.status));
    const escalated = open.filter((i) => i.status === "ESCALATED");
    const unassigned = open.filter((i) => !i.assignedTo);
    const oldest = open.reduce<(typeof INCIDENTS)[number] | null>(
      (acc, incident) => (acc === null || incident.createdAt < acc.createdAt ? incident : acc),
      null,
    );

    const body: NowTilesData = {
      openIncidents: { value: open.length, deltaVsPrevious: -1 },
      escalated: { value: escalated.length, deltaVsPrevious: 0 },
      unassigned: { value: unassigned.length, deltaVsPrevious: 1 },
      oldestOpen: oldest
        ? {
            ageMinutes: Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / 60_000),
            priority: oldest.priority,
          }
        : { ageMinutes: null, priority: null },
    };
    return HttpResponse.json(body);
  }),
];
