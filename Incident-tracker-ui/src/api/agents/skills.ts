import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { Environment, RiskLevel } from "../types";
import type { AgentDetailData } from "./roster";

export interface ActionTypeOption {
  actionType: string;
  // False for SQL, LAMBDA and KUBERNETES: the Decision Agent's prompt offers them
  // to the planner and nothing is registered to carry them out, so approving one
  // fails immediately having attempted nothing. Derived on the server from the
  // same registry the executor consults.
  hasExecutor: boolean;
  executor: string | null;
}

export interface ActionTypesData {
  actionTypes: ActionTypeOption[];
  riskLevels: RiskLevel[];
  environments: Environment[];
}

// What a skill's fields are, on the wire. Every one optional on edit; create
// additionally requires name and actionType, which the server enforces.
export interface SkillPayload {
  name?: string;
  description?: string | null;
  actionType?: string;
  riskLevel?: RiskLevel;
  environments?: string[];
  enabled?: boolean;
  // Omit to leave the binding alone; send null to clear it. Those are different
  // intentions and the server distinguishes them, so this must not be collapsed
  // into `serviceId?: string` and an empty string.
  serviceId?: string | null;
}

export function fetchActionTypes(): Promise<ActionTypesData> {
  return apiRequest<ActionTypesData>("/api/action-types");
}

export function createSkill(agentId: string, body: SkillPayload): Promise<AgentDetailData> {
  return apiRequest<AgentDetailData>(`/api/agents/${agentId}/skills`, {
    method: "POST",
    body,
  });
}

export function updateSkillFields(
  skillId: string,
  body: SkillPayload,
): Promise<AgentDetailData> {
  return apiRequest<AgentDetailData>(`/api/skills/${skillId}`, { method: "PATCH", body });
}

export function deleteSkill(skillId: string): Promise<AgentDetailData> {
  return apiRequest<AgentDetailData>(`/api/skills/${skillId}`, { method: "DELETE" });
}

// The vocabulary changes when a tool is registered, which is a deploy. Fetched
// once and kept.
export function useActionTypes() {
  return useQuery({
    queryKey: ["action-types"],
    queryFn: fetchActionTypes,
    staleTime: Infinity,
  });
}

export function useCreateSkill(agentId: string) {
  return useMutation({
    mutationKey: ["agents", agentId, "skills", "create"],
    mutationFn: (body: SkillPayload) => createSkill(agentId, body),
  });
}

export function useUpdateSkillFields(agentId: string) {
  return useMutation({
    mutationKey: ["agents", agentId, "skills", "update"],
    mutationFn: ({ skillId, body }: { skillId: string; body: SkillPayload }) =>
      updateSkillFields(skillId, body),
  });
}

export function useDeleteSkill(agentId: string) {
  return useMutation({
    mutationKey: ["agents", agentId, "skills", "delete"],
    mutationFn: (skillId: string) => deleteSkill(skillId),
  });
}
