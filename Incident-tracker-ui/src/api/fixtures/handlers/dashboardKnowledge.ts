import { http, HttpResponse } from "msw";
import { INCIDENTS, SERVICES, KNOWLEDGE_DOCUMENTS, KNOWLEDGE_EMBEDDINGS, SIMILARITY_MATCHES, BREAKDOWN_BY_SERVICE } from "../seededDataset";
import { sortAscendingByKnownRate } from "../../../domain/coverageGaps";
import type { KnowledgeData } from "../../dashboard/knowledge";

const CLOSED_STATUSES = ["RESOLVED", "CLOSED"];

// Unlike the funnel's own PRD-worked-example numbers (a deliberately wider history than the
// handful of incidents kept here), nothing in the PRD gives Knowledge tiles an explicit example
// to match — so these are computed directly from the fixture arrays, honestly small-scale.
export const dashboardKnowledgeHandlers = [
  http.get("/api/dashboard/knowledge", () => {
    const distinctDocumentTypes = new Set(KNOWLEDGE_DOCUMENTS.map((d) => d.type));

    const runbookMatchedServiceIds = new Set(
      SIMILARITY_MATCHES.filter((match) => {
        const doc = KNOWLEDGE_DOCUMENTS.find((d) => d.id === match.knowledgeDocumentId);
        return doc?.type === "RUNBOOK";
      }).map((match) => INCIDENTS.find((i) => i.id === match.incidentId)?.serviceId),
    );

    // FR-099/K1: strictly resolved + undocumented — narrower than K4's candidates backlog, which
    // also includes unresolved repeat incidents (data-model.md's own distinction).
    const undocumentedResolutionCount = INCIDENTS.filter(
      (i) => CLOSED_STATUSES.includes(i.status) && !i.isKnownIncident,
    ).length;

    const body: KnowledgeData = {
      tiles: {
        knowledgeDocumentCount: KNOWLEDGE_EMBEDDINGS.length,
        distinctDocumentTypeCount: distinctDocumentTypes.size,
        servicesWithRunbookCount: runbookMatchedServiceIds.size,
        totalServiceCount: SERVICES.length,
        undocumentedResolutionCount,
      },
      coverageGaps: sortAscendingByKnownRate(
        BREAKDOWN_BY_SERVICE.map((s) => ({ serviceId: s.serviceId, serviceName: s.serviceName, knownRate: s.knownRate })),
      ),
      documentsDrivingResolutions: [...KNOWLEDGE_DOCUMENTS]
        .sort((a, b) => b.resolutionCount - a.resolutionCount)
        .map((doc) => ({
          documentId: doc.id,
          documentType: doc.type,
          title: doc.title,
          resolutionCount: doc.resolutionCount,
        })),
    };

    return HttpResponse.json(body);
  }),
];
