import { http, HttpResponse } from "msw";
import {
  INCIDENTS,
  SERVICES,
  RECOMMENDED_ACTIONS,
  EXECUTED_ACTIONS,
  SIMILARITY_MATCHES,
  FUNNEL_DROPSET_INCIDENTS,
  CANDIDATE_INCIDENT_IDS,
  CANDIDATE_RECURRENCE,
} from "../seededDataset";
import type { AutomationStatus, Incident, Priority } from "../../types";
import type { IncidentListResponse } from "../../incidents/list";
import { formatAge } from "../../../domain/age";

const CLOSED_STATUSES = ["RESOLVED", "CLOSED"];
const PRIORITY_ORDER: Record<Priority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

// K4/FR-103: "why it qualifies" — manual resolution time (when resolved) plus the missing-match
// reason. Recurrence is its own structured field (recurrenceCount), not folded into this prose, so
// the client can render/withhold it independently per FR-103's >1 threshold.
function candidateReasonFor(incident: Incident): string {
  const parts: string[] = [];
  if (incident.resolvedAt) {
    const minutes = Math.round(
      (new Date(incident.resolvedAt).getTime() - new Date(incident.createdAt).getTime()) / 60_000,
    );
    parts.push(`resolved manually in ${formatAge(minutes)}`);
  }
  parts.push("no RAG match found");
  return parts.join(" · ");
}

function automationStatusFor(incidentId: string): AutomationStatus {
  const actions = RECOMMENDED_ACTIONS.filter((a) => a.incidentId === incidentId);
  if (actions.length === 0) return "none";
  if (actions.some((a) => a.status === "PROPOSED")) return "needs_human";

  const succeeded = (actionId: string) =>
    EXECUTED_ACTIONS.some((e) => e.recommendedActionId === actionId && e.status === "SUCCESS");

  if (actions.some((a) => !a.approvalRequired && succeeded(a.id))) return "fully_automated";
  if (actions.some((a) => a.approvalRequired && a.status === "APPROVED" && succeeded(a.id))) {
    return "human_approved";
  }
  return "needs_human";
}

// US1 scope: status/env/service/search/includeResolved/sort/page + the Now-tab kpiTile
// drill-downs. funnelDropAt/funnelStage/breakdown/candidate are extended in by US3/US4/US5
// (tasks.md's shared-file caveat).
export const incidentsListHandlers = [
  http.get("/api/incidents", ({ request }) => {
    const url = new URL(request.url);
    const includeResolved = url.searchParams.get("includeResolved") === "true";
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    const envParam = url.searchParams.get("env");
    const serviceParam = url.searchParams.get("service");
    const kpiTile = url.searchParams.get("kpiTile");
    const funnelDropAt = url.searchParams.get("funnelDropAt");
    const funnelStage = url.searchParams.get("funnelStage");
    const candidate = url.searchParams.get("candidate") === "true";
    const breakdown = url.searchParams.get("breakdown");
    const sort = url.searchParams.get("sort");
    const page = Number(url.searchParams.get("page") ?? "1");

    // FR-085/FR-086: a funnel drop-set replaces the base row set entirely — these are the
    // incidents behind that stage's dropCount, not a further filter of the ~9 detail incidents.
    // FR-088's funnelStage=received and FR-082's medianResolve tile both need everything, not the
    // open-only default — resolved incidents would otherwise already be excluded before either
    // filter ever runs. K4's candidates aren't necessarily resolved either (a repeat incident with
    // no runbook still qualifies while open). Global filters (env/service/search) still apply on
    // top of any base (FR-025).
    let rows: typeof INCIDENTS;
    if (funnelDropAt && funnelDropAt in FUNNEL_DROPSET_INCIDENTS) {
      rows = [...FUNNEL_DROPSET_INCIDENTS[funnelDropAt]];
    } else if (candidate) {
      rows = INCIDENTS.filter((i) => (CANDIDATE_INCIDENT_IDS as readonly string[]).includes(i.id));
    } else if (funnelStage === "received" || kpiTile === "medianResolve") {
      rows = [...INCIDENTS];
    } else {
      rows = INCIDENTS.filter((i) => includeResolved || !CLOSED_STATUSES.includes(i.status));
    }

    if (envParam) {
      const envs = envParam.split(",");
      rows = rows.filter((i) => envs.includes(i.environment));
    }
    if (serviceParam) {
      rows = rows.filter((i) => i.serviceId === serviceParam);
    }
    if (q) {
      rows = rows.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.externalId.toLowerCase().includes(q),
      );
    }

    if (kpiTile === "escalated") {
      rows = rows.filter((i) => i.status === "ESCALATED");
    } else if (kpiTile === "unassigned") {
      rows = rows.filter((i) => !i.assignedTo && !CLOSED_STATUSES.includes(i.status));
    } else if (kpiTile === "openIncidents") {
      rows = rows.filter((i) => !CLOSED_STATUSES.includes(i.status));
    } else if (kpiTile === "oldestOpen") {
      const open = rows.filter((i) => !CLOSED_STATUSES.includes(i.status));
      const oldest = open.reduce<(typeof open)[number] | null>(
        (acc, i) => (acc === null || i.createdAt < acc.createdAt ? i : acc),
        null,
      );
      rows = oldest ? [oldest] : [];
    } else if (kpiTile === "automationRate") {
      // FR-082/FR-089: same definition as the automation-rate tile — never required approval.
      rows = rows.filter((i) => automationStatusFor(i.id) === "fully_automated");
    } else if (kpiTile === "medianResolve") {
      rows = rows.filter((i) => CLOSED_STATUSES.includes(i.status));
    } else if (kpiTile === "knownHitRate") {
      rows = rows.filter((i) => i.isKnownIncident);
    }

    // FR-097/FR-098: breakdown=<kind>:<value>, e.g. "priority:P1", "category:Database",
    // "service:svc-payments-api" — the same cross-tab drill-down mechanism as the funnel.
    if (breakdown) {
      const [kind, value] = breakdown.split(":");
      if (kind === "priority") {
        rows = rows.filter((i) => i.priority === value);
      } else if (kind === "category") {
        rows = rows.filter((i) => i.category === value);
      } else if (kind === "service") {
        rows = rows.filter((i) => i.serviceId === value);
      }
    }

    const sorted = [...rows].sort((a, b) => {
      if (sort === "age") return a.createdAt.localeCompare(b.createdAt);
      if (sort === "confidence") return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
      const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return byPriority !== 0 ? byPriority : b.createdAt.localeCompare(a.createdAt);
    });

    const pageSize = 25;
    const start = (page - 1) * pageSize;
    const pageRows = sorted.slice(start, start + pageSize);

    const body: IncidentListResponse = {
      rows: pageRows.map((i) => {
        const bestMatch = SIMILARITY_MATCHES.filter((m) => m.incidentId === i.id).sort(
          (a, b) => b.score - a.score,
        )[0];
        return {
          id: i.id,
          externalId: i.externalId,
          priority: i.priority,
          status: i.status,
          title: i.title,
          serviceName: SERVICES.find((s) => s.id === i.serviceId)?.name ?? "",
          environment: i.environment,
          category: i.category,
          isKnownIncident: i.isKnownIncident,
          bestMatchScore: bestMatch?.score ?? null,
          confidenceScore: i.confidenceScore,
          createdAt: i.createdAt,
          assignedTo: i.assignedTo,
          automationStatus: automationStatusFor(i.id),
          source: i.source,
          candidateReason: candidate ? candidateReasonFor(i) : null,
          // Contract: only populated when candidate=true AND > 1 (FR-103) — the field itself is
          // null otherwise, not just hidden client-side.
          recurrenceCount: candidate && (CANDIDATE_RECURRENCE[i.id] ?? 0) > 1 ? CANDIDATE_RECURRENCE[i.id] : null,
        };
      }),
      totalCount: sorted.length,
      page,
    };

    return HttpResponse.json(body);
  }),
];
