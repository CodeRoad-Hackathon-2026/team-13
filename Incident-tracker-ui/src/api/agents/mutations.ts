import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { RiskLevel } from "../types";
import type { AgentDetailData, Autonomy, Disposition } from "./roster";

// Every one of these changes what the orchestrator does on the next incident —
// they are not preferences. The response is the whole refreshed agent, so a call
// site can replace its state without a second read and without guessing what
// else the change implied.
export function updateAgent(
  agentId: string,
  body: { isActive?: boolean; autonomy?: Autonomy },
): Promise<AgentDetailData> {
  return apiRequest<AgentDetailData>(`/api/agents/${agentId}`, { method: "PATCH", body });
}

export function updateRiskPolicy(
  agentId: string,
  riskLevel: RiskLevel,
  disposition: Disposition,
): Promise<AgentDetailData> {
  return apiRequest<AgentDetailData>(`/api/agents/${agentId}/risk-policy/${riskLevel}`, {
    method: "PATCH",
    body: { disposition },
  });
}

export function updateSkill(skillId: string, enabled: boolean): Promise<AgentDetailData> {
  return apiRequest<AgentDetailData>(`/api/skills/${skillId}`, {
    method: "PATCH",
    body: { enabled },
  });
}

// Scoped by agent, following the house pattern in api/approvals/approve.ts: no
// invalidation here, so the call site owns the optimistic flip and the rollback.
export function useUpdateAgent(agentId: string) {
  return useMutation({
    mutationKey: ["agents", agentId, "update"],
    mutationFn: (body: { isActive?: boolean; autonomy?: Autonomy }) =>
      updateAgent(agentId, body),
  });
}

export function useUpdateRiskPolicy(agentId: string) {
  return useMutation({
    mutationKey: ["agents", agentId, "risk-policy"],
    mutationFn: ({ riskLevel, disposition }: { riskLevel: RiskLevel; disposition: Disposition }) =>
      updateRiskPolicy(agentId, riskLevel, disposition),
  });
}

export function useUpdateSkill(agentId: string) {
  return useMutation({
    mutationKey: ["agents", agentId, "skill"],
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      updateSkill(skillId, enabled),
  });
}
