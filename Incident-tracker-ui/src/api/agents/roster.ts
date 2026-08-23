import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { RiskLevel } from "../types";

export type Autonomy = "observe" | "suggest" | "act_with_approval" | "act_autonomously";
export type Disposition = "auto_run" | "ask_first" | "never";
// What actually calls this agent. "nothing" is a real answer for two of them and
// the roster says so — the point of this tab is that eight registered agents are
// not eight running agents.
export type InvokedBy = "ingest" | "pipeline" | "approval" | "nothing" | "unknown";

export interface AgentRuns {
  total: number;
  successful: number;
  failed: number;
  // null when nothing has run. A success rate of zero and no runs at all are
  // different findings, and only one of them is a problem.
  successRatePercent: number | null;
  avgConfidence: number | null;
  avgLatencyMs: number | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string | null;
  version: string;
  isActive: boolean;
  autonomy: Autonomy;
  updatedAt: string | null;
  hasModule: boolean;
  invokedBy: InvokedBy;
  detail: string;
  runs: AgentRuns;
}

export interface RosterData {
  agents: AgentSummary[];
  // Whether the server will accept act_autonomously at all. Off by default: that
  // level removes the human from the loop and /api/* has no authentication, so it
  // needs a deliberate server-side opt-in.
  autonomyEnabled: boolean;
  autonomyLevels: Autonomy[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string | null;
  actionType: string;
  riskLevel: RiskLevel;
  // The id is what the form pre-selects; the name is what a card renders. A
  // dropdown matched on the display name would be selecting a row by something
  // that is not its key.
  serviceId: string | null;
  serviceName: string | null;
  environments: string[];
  enabled: boolean;
  usage: { runs: number; successPercent: number | null; scope: string };
}

export interface AgentDetailData extends AgentSummary {
  riskPolicy: Array<{ riskLevel: RiskLevel; disposition: Disposition }>;
  skills: AgentSkill[];
  context: Array<{ documentType: string; count: number }>;
  prompt: { editable: boolean; note: string };
  autonomyEnabled: boolean;
  autonomyLevels: Autonomy[];
  dispositions: Disposition[];
}

export function fetchRoster(): Promise<RosterData> {
  return apiRequest<RosterData>("/api/agents");
}

export function fetchAgent(agentId: string): Promise<AgentDetailData> {
  return apiRequest<AgentDetailData>(`/api/agents/${agentId}`);
}

// The roster is configuration, not telemetry: it changes when somebody changes
// it. Polled slowly rather than not at all, because two operators may be looking
// at the same page.
export function useRoster() {
  return useQuery({ queryKey: ["agents"], queryFn: fetchRoster, refetchInterval: 60_000 });
}

export function useAgent(agentId: string | null) {
  return useQuery({
    queryKey: ["agents", agentId],
    queryFn: () => fetchAgent(agentId as string),
    enabled: Boolean(agentId),
  });
}
