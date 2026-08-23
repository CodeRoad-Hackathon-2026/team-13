import { http, HttpResponse } from "msw";
import { SERVICES } from "../seededDataset";
import type { AgentDetailData, AgentSummary, RosterData } from "../../agents/roster";
import type { GuardrailsData } from "../../agents/guardrails";
import type { ConnectionsData } from "../../agents/connections";

// Mirrors app/api/agents.py, including the parts that are uncomfortable: two of
// the eight agents are not called by anything and one has no module at all. A
// fixture that showed eight healthy peers would make the roster look pointless,
// which is the opposite of why it exists.
//
// Mutable, so a toggle in dev actually sticks and the optimistic-rollback path
// can be exercised. Resets on reload.
let autonomyEnabled = false;

const AGENTS: AgentSummary[] = [
  {
    id: "agent-intake",
    name: "Incident Intake Agent",
    description: "Parses inbound email, Slack, PagerDuty and API payloads into an incident record.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: "2026-08-20T09:00:00Z",
    hasModule: true,
    invokedBy: "ingest",
    detail: "Runs on every inbound payload, before triage.",
    runs: { total: 8, successful: 8, failed: 0, successRatePercent: 100, avgConfidence: null, avgLatencyMs: 1 },
  },
  {
    id: "agent-classification",
    name: "Classification Agent",
    description: "Assigns category, priority, affected service and environment to an incident.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: "2026-08-20T09:00:00Z",
    hasModule: true,
    invokedBy: "pipeline",
    detail: "First step of triage. Allowed to fail without stopping the run.",
    runs: { total: 11, successful: 11, failed: 0, successRatePercent: 100, avgConfidence: 0.568, avgLatencyMs: 4604 },
  },
  {
    id: "agent-retrieval",
    name: "RAG Retrieval Agent",
    description: "Searches the knowledge base for similar incidents, runbooks and postmortems.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: "2026-08-20T09:00:00Z",
    hasModule: true,
    invokedBy: "pipeline",
    detail: "Second step. If it finds nothing, the pipeline stops before proposing.",
    runs: { total: 12, successful: 12, failed: 0, successRatePercent: 100, avgConfidence: 0.632, avgLatencyMs: 787 },
  },
  {
    id: "agent-decision",
    name: "Decision Agent",
    description: "Decides whether the incident is known and proposes remediation actions.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: "2026-08-21T14:00:00Z",
    hasModule: true,
    invokedBy: "pipeline",
    detail: "Third step, and the only agent that proposes actions.",
    runs: { total: 13, successful: 13, failed: 0, successRatePercent: 100, avgConfidence: 0.611, avgLatencyMs: 4864 },
  },
  {
    id: "agent-execution",
    name: "Execution Agent",
    description: "Executes approved actions through the registered MCP tools.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: "2026-08-20T09:00:00Z",
    hasModule: true,
    invokedBy: "approval",
    detail: "Runs on approval, or unattended when the policy allows it.",
    runs: { total: 3, successful: 3, failed: 0, successRatePercent: 100, avgConfidence: null, avgLatencyMs: 77 },
  },
  {
    id: "agent-delivery",
    name: "Change Delivery Agent",
    description: "Clones the target repository, proves an approved code change applies, and pushes a branch.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: "2026-08-20T09:00:00Z",
    hasModule: true,
    invokedBy: "approval",
    detail: "Dispatched by the Execution Agent for a GITHUB_PR action.",
    runs: { total: 3, successful: 3, failed: 0, successRatePercent: 100, avgConfidence: null, avgLatencyMs: 1 },
  },
  {
    id: "agent-knowledge",
    name: "Knowledge Generation Agent",
    description: "Turns resolved incidents into knowledge documents for future retrieval.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: "2026-08-20T09:00:00Z",
    hasModule: true,
    invokedBy: "nothing",
    detail: "Implemented, but no route or pipeline step calls it yet.",
    runs: { total: 1, successful: 1, failed: 0, successRatePercent: 100, avgConfidence: 0.95, avgLatencyMs: 5200 },
  },
  {
    id: "agent-validation",
    name: "Validation Agent",
    description: "Verifies that an executed action resolved the incident.",
    version: "1",
    isActive: true,
    autonomy: "act_with_approval",
    updatedAt: "2026-08-20T09:00:00Z",
    hasModule: false,
    invokedBy: "nothing",
    detail:
      "Registered here with no module behind it. This is why the funnel's " +
      "'Validated + resolved' stage reads as unavailable rather than zero.",
    runs: { total: 1, successful: 0, failed: 1, successRatePercent: 0, avgConfidence: null, avgLatencyMs: 30400 },
  },
];

const RISK_POLICY: Record<string, Record<string, string>> = {};
for (const agent of AGENTS) {
  RISK_POLICY[agent.id] = { HIGH: "ask_first", MEDIUM: "ask_first", LOW: "ask_first" };
}
// Only the Decision Agent proposes anything, so it is the only one whose auto-run
// has an effect — the seeds make the same choice.
RISK_POLICY["agent-decision"].LOW = "auto_run";

interface Skill {
  id: string;
  name: string;
  description: string;
  actionType: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  serviceName: string;
  environments: string[];
  enabled: boolean;
  runs: number;
  successPercent: number | null;
}

// The form pre-selects by id, so the fixture has to agree with the service list
// the same fixture layer serves.
function serviceIdFor(name: string | null): string | null {
  if (!name) return null;
  return SERVICES.find((s) => s.name === name)?.id ?? null;
}

const SKILLS: Skill[] = [
  {
    id: "skill-pool",
    name: "Restart the connection pool",
    description: "Raises the pgbouncer ceiling and drains idle clients.",
    actionType: "API",
    riskLevel: "HIGH",
    serviceName: "payments-api",
    environments: ["Production", "Staging"],
    enabled: true,
    runs: 24,
    successPercent: 100,
  },
  {
    id: "skill-cdn",
    name: "Purge the CDN cache",
    description: "Soft purge by surrogate key, so the origin is not stampeded.",
    actionType: "API",
    riskLevel: "MEDIUM",
    serviceName: "checkout-web",
    environments: ["Production"],
    enabled: true,
    runs: 61,
    successPercent: 98,
  },
  {
    id: "skill-timeout",
    name: "Lower the upstream client timeout",
    description:
      "Reduces read_timeout_seconds and max_retries in config/http_clients.yml so one slow upstream call cannot starve the worker pool.",
    actionType: "GITHUB_PR",
    riskLevel: "MEDIUM",
    serviceName: "checkout-web",
    environments: ["Production", "Staging"],
    enabled: true,
    runs: 3,
    successPercent: 0,
  },
  {
    id: "skill-nplus1",
    name: "Hoist the N+1 warehouse lookup",
    description: "Moves the per-item warehouse query out of the sync loop in app/jobs/inventory_sync.py.",
    actionType: "GITHUB_PR",
    riskLevel: "LOW",
    serviceName: "inventory-service",
    environments: ["Production"],
    enabled: true,
    runs: 3,
    successPercent: 0,
  },
  {
    id: "skill-index",
    name: "Add the notifications dequeue index",
    description: "Adds the composite index the dequeue query needs, in a new migration file.",
    actionType: "GITHUB_PR",
    riskLevel: "MEDIUM",
    serviceName: "notify-worker",
    environments: ["Production"],
    enabled: false,
    runs: 3,
    successPercent: 0,
  },
];

let guardrails: GuardrailsData = {
  maxConcurrentExecutions: 2,
  neverTouchServices: ["billing-core", "kms-signer"],
  blackout: { startDow: 5, startTime: "16:00", endDow: 1, endTime: "06:00" },
};

function detailFor(agentId: string): AgentDetailData | null {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) return null;
  const policy = RISK_POLICY[agentId];
  return {
    ...agent,
    riskPolicy: (["HIGH", "MEDIUM", "LOW"] as const).map((riskLevel) => ({
      riskLevel,
      disposition: policy[riskLevel] as AgentDetailData["riskPolicy"][number]["disposition"],
    })),
    // Only the agent that proposes actions has a catalogue of them.
    skills:
      agentId === "agent-decision"
        ? SKILLS.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            actionType: s.actionType,
            riskLevel: s.riskLevel,
            serviceId: serviceIdFor(s.serviceName),
            serviceName: s.serviceName,
            environments: s.environments,
            enabled: s.enabled,
            usage: { runs: s.runs, successPercent: s.successPercent, scope: "action type" },
          }))
        : [],
    context: [
      { documentType: "RUNBOOK", count: 142 },
      { documentType: "POSTMORTEM", count: 38 },
    ],
    prompt: {
      editable: false,
      note:
        "This agent's prompt is a literal in app/agents/. Retrieval and answer " +
        "prompts are versioned in RAG Core and edited there.",
    },
    autonomyEnabled,
    autonomyLevels: ["observe", "suggest", "act_with_approval", "act_autonomously"],
    dispositions: ["auto_run", "ask_first", "never"],
  };
}

export const agentsHandlers = [
  http.get("/api/agents", () => {
    const body: RosterData = {
      agents: AGENTS,
      autonomyEnabled,
      autonomyLevels: ["observe", "suggest", "act_with_approval", "act_autonomously"],
    };
    return HttpResponse.json(body);
  }),

  http.get("/api/agents/:id", ({ params }) => {
    const detail = detailFor(String(params.id));
    if (!detail) return new HttpResponse("Agent not found", { status: 404 });
    return HttpResponse.json(detail);
  }),

  http.patch("/api/agents/:id", async ({ params, request }) => {
    const agent = AGENTS.find((a) => a.id === params.id);
    if (!agent) return new HttpResponse("Agent not found", { status: 404 });
    const body = (await request.json()) as { isActive?: boolean; autonomy?: string };

    // The same refusal the server makes, so the disabled option is exercised in
    // dev rather than only asserted in a test.
    if (body.autonomy === "act_autonomously" && !autonomyEnabled) {
      return new HttpResponse(
        "acting autonomously is off on this server; set AGENT_AUTONOMY_ENABLED to allow it",
        { status: 400 },
      );
    }
    if (body.isActive !== undefined) agent.isActive = body.isActive;
    if (body.autonomy) agent.autonomy = body.autonomy as AgentSummary["autonomy"];
    return HttpResponse.json(detailFor(agent.id));
  }),

  http.patch("/api/agents/:id/risk-policy/:risk", async ({ params, request }) => {
    const policy = RISK_POLICY[String(params.id)];
    if (!policy) return new HttpResponse("Agent not found", { status: 404 });
    const body = (await request.json()) as { disposition: string };
    policy[String(params.risk).toUpperCase()] = body.disposition;
    return HttpResponse.json(detailFor(String(params.id)));
  }),

  http.patch("/api/skills/:id", async ({ params, request }) => {
    const skill = SKILLS.find((s) => s.id === params.id);
    if (!skill) return new HttpResponse("Skill not found", { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (SKILLS.some((s) => s.id !== skill.id && s.name === name)) {
        return new HttpResponse(`a skill called '${name}' already exists on this agent`, {
          status: 400,
        });
      }
      skill.name = name;
    }
    if (body.description !== undefined) skill.description = String(body.description ?? "");
    if (body.actionType !== undefined) skill.actionType = String(body.actionType).toUpperCase();
    if (body.riskLevel !== undefined)
      skill.riskLevel = String(body.riskLevel).toUpperCase() as Skill["riskLevel"];
    if (body.environments !== undefined) skill.environments = body.environments as string[];
    if (body.enabled !== undefined) skill.enabled = Boolean(body.enabled);
    // Present-and-null clears it; absent leaves it alone. Same distinction the
    // server makes, so the form's behaviour in dev matches production.
    if ("serviceId" in body) {
      const id = body.serviceId ? String(body.serviceId) : null;
      skill.serviceName = SERVICES.find((s) => s.id === id)?.name ?? "";
    }
    return HttpResponse.json(detailFor("agent-decision"));
  }),

  // Mirrors app/api/agents.py: the vocabulary the Decision Agent's prompt offers
  // the planner, with the three types nothing can carry out marked as such.
  http.get("/api/action-types", () =>
    HttpResponse.json({
      actionTypes: [
        { actionType: "API", hasExecutor: true, executor: "http tool" },
        { actionType: "WEBHOOK", hasExecutor: true, executor: "http tool" },
        { actionType: "GITHUB_PR", hasExecutor: true, executor: "Change Delivery Agent" },
        { actionType: "SQL", hasExecutor: false, executor: null },
        { actionType: "LAMBDA", hasExecutor: false, executor: null },
        { actionType: "KUBERNETES", hasExecutor: false, executor: null },
      ],
      riskLevels: ["LOW", "MEDIUM", "HIGH"],
      environments: ["Development", "Production", "Staging"],
    }),
  ),

  http.post("/api/agents/:id/skills", async ({ params, request }) => {
    if (params.id !== "agent-decision") {
      return new HttpResponse(
        "That agent does not propose actions, so a skill on it would never be consulted. " +
          "Only the Decision Agent has skills.",
        { status: 400 },
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    if (SKILLS.some((s) => s.name === name)) {
      return new HttpResponse(`Decision Agent already has a skill called '${name}'`, {
        status: 400,
      });
    }
    const serviceId = body.serviceId ? String(body.serviceId) : null;
    SKILLS.push({
      id: `skill-${Date.now()}`,
      name,
      description: String(body.description ?? ""),
      actionType: String(body.actionType ?? "API").toUpperCase(),
      riskLevel: (String(body.riskLevel ?? "MEDIUM").toUpperCase() as Skill["riskLevel"]),
      serviceName: SERVICES.find((s) => s.id === serviceId)?.name ?? "",
      environments: (body.environments as string[]) ?? [],
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      runs: 0,
      successPercent: null,
    });
    return HttpResponse.json(detailFor("agent-decision"), { status: 201 });
  }),

  http.delete("/api/skills/:id", ({ params }) => {
    const index = SKILLS.findIndex((s) => s.id === params.id);
    if (index === -1) return new HttpResponse("Skill not found", { status: 404 });
    SKILLS.splice(index, 1);
    return HttpResponse.json(detailFor("agent-decision"));
  }),

  http.get("/api/guardrails", () => HttpResponse.json(guardrails)),

  http.patch("/api/guardrails", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    guardrails = {
      maxConcurrentExecutions:
        (body.maxConcurrentExecutions as number) ?? guardrails.maxConcurrentExecutions,
      neverTouchServices:
        (body.neverTouchServices as string[]) ?? guardrails.neverTouchServices,
      blackout: body.clearBlackout
        ? null
        : body.blackoutStartDow !== undefined
          ? {
              startDow: body.blackoutStartDow as number,
              startTime: body.blackoutStartTime as string,
              endDow: body.blackoutEndDow as number,
              endTime: body.blackoutEndTime as string,
            }
          : guardrails.blackout,
    };
    return HttpResponse.json(guardrails);
  }),

  http.get("/api/connections", () => {
    // Real shapes, including the two cases the mockup's "Connected / Not
    // connected" could not express: a source that has never run, and one whose
    // last run failed.
    const body: ConnectionsData = {
      sources: [
        {
          id: "src-1", name: "Runbooks (Confluence)", type: "confluence",
          collection: "incidents", enabled: true,
          lastRunAt: "2026-08-22T02:10:00Z", lastStatus: "ok", lastError: null,
        },
        {
          id: "src-2", name: "payments-api repo", type: "git_repo",
          collection: "incidents", enabled: true,
          lastRunAt: "2026-08-22T01:40:00Z", lastStatus: "ok", lastError: null,
        },
        {
          id: "src-3", name: "PagerDuty incidents", type: "http_json",
          collection: "incidents", enabled: true,
          lastRunAt: "2026-08-21T23:05:00Z", lastStatus: "error",
          lastError: "401 from the incidents endpoint — the token may have expired",
        },
        {
          id: "src-4", name: "Postmortem tickets (Jira)", type: "jira",
          collection: "incidents", enabled: true,
          lastRunAt: null, lastStatus: null, lastError: null,
        },
        {
          id: "src-5", name: "CloudWatch — prod", type: "aws_logs",
          collection: "incidents", enabled: false,
          lastRunAt: "2026-08-19T08:00:00Z", lastStatus: "ok", lastError: null,
        },
      ],
      unavailable: null,
    };
    return HttpResponse.json(body);
  }),
];
