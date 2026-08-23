import { http, HttpResponse } from "msw";
import {
  INCIDENTS,
  SERVICES,
  AGENT_RUNS,
  SIMILARITY_MATCHES,
  KNOWLEDGE_DOCUMENTS,
  RECOMMENDED_ACTIONS,
  EXECUTED_ACTIONS,
  INCIDENT_EVENTS,
  DEVELOPER_FEEDBACK,
} from "../seededDataset";
import type { IncidentDetail } from "../../incidents/detail";

const FAILURE_EVENT_TYPES = new Set(["VALIDATION_FAILED", "ACTION_REJECTED", "ESCALATED"]);

function buildDetail(incidentId: string): IncidentDetail | null {
  const incident = INCIDENTS.find((i) => i.id === incidentId);
  if (!incident) return null;

  const correctionRow = DEVELOPER_FEEDBACK.find(
    (f) => f.incidentId === incidentId && (f.correctedCategory || f.correctedPriority),
  );

  return {
    incident: {
      id: incident.id,
      externalId: incident.externalId,
      title: incident.title,
      status: incident.status,
      priority: incident.priority,
      serviceName: SERVICES.find((s) => s.id === incident.serviceId)?.name ?? "",
      environment: incident.environment,
      assignedTo: incident.assignedTo,
      createdAt: incident.createdAt,
      resolvedAt: incident.resolvedAt,
      source: incident.source,
    },
    aiClassification: {
      category: incident.category,
      priority: incident.priority,
      confidenceScore: incident.confidenceScore,
    },
    correction: correctionRow
      ? { correctedCategory: correctionRow.correctedCategory, correctedPriority: correctionRow.correctedPriority }
      : null,
    agentRuns: AGENT_RUNS.filter((r) => r.incidentId === incidentId).map((r) => ({
      id: r.id,
      agentName: r.agentName,
      agentVersion: r.agentVersion,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      latencyMs: r.latencyMs,
      confidenceScore: r.confidenceScore,
      hasError: r.status === "FAILED",
    })),
    similarityMatches: SIMILARITY_MATCHES.filter((m) => m.incidentId === incidentId)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((m) => {
        const doc = KNOWLEDGE_DOCUMENTS.find((d) => d.id === m.knowledgeDocumentId)!;
        return {
          id: m.id,
          documentType: doc.type,
          title: doc.title,
          score: m.score,
          summarySnippet: doc.summary,
          sourceUrl: doc.sourceUrl,
        };
      }),
    actions: RECOMMENDED_ACTIONS.filter((a) => a.incidentId === incidentId).map((a) => {
      const execution = EXECUTED_ACTIONS.find((e) => e.recommendedActionId === a.id);
      return {
        id: a.id,
        actionType: a.actionType,
        description: a.description,
        riskLevel: a.riskLevel,
        confidenceScore: a.confidenceScore,
        status: a.status,
        approvedBy: a.approvedBy,
        approvedAt: a.approvedAt,
        execution: execution
          ? {
              id: execution.id,
              status: execution.status,
              startedAt: execution.startedAt,
              finishedAt: execution.finishedAt,
              errorMessage: execution.errorMessage,
            }
          : null,
      };
    }),
    events: buildEvents(incidentId, false),
    feedback: DEVELOPER_FEEDBACK.filter((f) => f.incidentId === incidentId).map((f) => ({
      id: f.id,
      feedbackType: f.feedbackType,
      comments: f.comments,
      correctedCategory: f.correctedCategory,
      correctedPriority: f.correctedPriority,
      correctedResolution: f.correctedResolution,
      createdBy: f.createdBy,
      createdAt: f.createdAt,
    })),
  };
}

function buildEvents(incidentId: string, agentOnly: boolean): IncidentDetail["events"] {
  return INCIDENT_EVENTS.filter((e) => e.incidentId === incidentId)
    .filter((e) => !agentOnly || e.createdBy.includes("Agent"))
    .map((e) => ({
      id: e.id,
      eventType: e.eventType,
      description: e.description,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
      isAgentEvent: e.createdBy.includes("Agent"),
      isFailureEvent: FAILURE_EVENT_TYPES.has(e.eventType),
    }));
}

export const incidentsDetailHandlers = [
  http.get("/api/incidents/:id", ({ params }) => {
    const detail = buildDetail(params.id as string);
    if (!detail) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(detail);
  }),

  http.get("/api/incidents/:id/agent-runs/:runId/io", ({ params }) => {
    const run = AGENT_RUNS.find((r) => r.id === params.runId && r.incidentId === params.id);
    if (!run) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ input: { note: "seeded fixture input" }, output: { note: "seeded fixture output" } });
  }),

  http.get("/api/actions/:id/parameters", ({ params }) => {
    const action = RECOMMENDED_ACTIONS.find((a) => a.id === params.id);
    if (!action) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ parameters: { note: "seeded fixture parameters" } });
  }),

  http.get("/api/executions/:id/detail", ({ params }) => {
    const execution = EXECUTED_ACTIONS.find((e) => e.id === params.id);
    if (!execution) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({
      responsePayload: { note: "seeded fixture response" },
      executionLogs: "[00.0] seeded fixture execution log",
    });
  }),

  http.get("/api/incidents/:id/similarity-matches", ({ params }) => {
    const matches = SIMILARITY_MATCHES.filter((m) => m.incidentId === params.id)
      .sort((a, b) => b.score - a.score)
      .map((m) => {
        const doc = KNOWLEDGE_DOCUMENTS.find((d) => d.id === m.knowledgeDocumentId)!;
        return {
          id: m.id,
          documentType: doc.type,
          title: doc.title,
          score: m.score,
          summarySnippet: doc.summary,
          sourceUrl: doc.sourceUrl,
        };
      });
    return HttpResponse.json({ matches });
  }),

  http.get("/api/incidents/:id/events", ({ params, request }) => {
    const agentOnly = new URL(request.url).searchParams.get("agentOnly") === "true";
    return HttpResponse.json({ events: buildEvents(params.id as string, agentOnly) });
  }),
];
