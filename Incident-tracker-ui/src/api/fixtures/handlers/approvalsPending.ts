import { http, HttpResponse } from "msw";
import {
  RECOMMENDED_ACTIONS,
  INCIDENTS,
  SERVICES,
  SIMILARITY_MATCHES,
  KNOWLEDGE_DOCUMENTS,
  AUTO_EXECUTED_COUNT_IN_RANGE,
} from "../seededDataset";
import type { Priority } from "../../types";
import type { PendingApprovalsData } from "../../approvals/pending";

const PRIORITY_ORDER: Record<Priority, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
const RISK_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const TOP_MATCHES_CAP = 3;

// FR-031/FR-032/AR-10: excludes approval_required=false server-side, sorted priority→risk→age —
// the client never filters or re-sorts this list itself.
export const approvalsPendingHandlers = [
  http.get("/api/approvals/pending", () => {
    const pending = RECOMMENDED_ACTIONS.filter((a) => a.status === "PROPOSED" && a.approvalRequired);

    const sorted = [...pending].sort((a, b) => {
      const incidentA = INCIDENTS.find((i) => i.id === a.incidentId)!;
      const incidentB = INCIDENTS.find((i) => i.id === b.incidentId)!;
      const byPriority = PRIORITY_ORDER[incidentA.priority] - PRIORITY_ORDER[incidentB.priority];
      if (byPriority !== 0) return byPriority;
      const byRisk = RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
      if (byRisk !== 0) return byRisk;
      return incidentA.createdAt.localeCompare(incidentB.createdAt);
    });

    const body: PendingApprovalsData = {
      cards: sorted.map((action) => {
        const incident = INCIDENTS.find((i) => i.id === action.incidentId)!;
        const topMatches = SIMILARITY_MATCHES.filter((m) => m.incidentId === incident.id)
          .sort((a, b) => b.score - a.score)
          .slice(0, TOP_MATCHES_CAP)
          .map((m) => {
            const doc = KNOWLEDGE_DOCUMENTS.find((d) => d.id === m.knowledgeDocumentId)!;
            return { documentType: doc.type, title: doc.title, score: m.score, sourceUrl: doc.sourceUrl };
          });

        return {
          id: action.id,
          incidentId: incident.id,
          incidentExternalId: incident.externalId,
          priority: incident.priority,
          serviceName: SERVICES.find((s) => s.id === incident.serviceId)?.name ?? "",
          environment: incident.environment,
          incidentTitle: incident.title,
          actionType: action.actionType,
          description: action.description,
          riskLevel: action.riskLevel,
          confidenceScore: action.confidenceScore,
          topMatches,
          // No proposed_at column exists on RecommendedAction (data-model.md); the incident's own
          // createdAt is the closest available proxy, consistent with how AgentRun duration falls
          // back to timestamps elsewhere in this dataset.
          proposedAt: incident.createdAt,
          proposedByAgent: "Decision Agent",
        };
      }),
      autoExecutedCountInRange: AUTO_EXECUTED_COUNT_IN_RANGE,
    };

    return HttpResponse.json(body);
  }),
];
