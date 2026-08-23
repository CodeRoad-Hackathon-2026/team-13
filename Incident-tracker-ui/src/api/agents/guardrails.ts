import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";

export interface BlackoutWindow {
  startDow: number;
  startTime: string;
  endDow: number;
  endTime: string;
}

export interface GuardrailsData {
  maxConcurrentExecutions: number;
  neverTouchServices: string[];
  // null means no window. All four fields or none — two of four would be a
  // window whose meaning depends on which two.
  blackout: BlackoutWindow | null;
}

export interface GuardrailsUpdate {
  maxConcurrentExecutions?: number;
  neverTouchServices?: string[];
  blackoutStartDow?: number;
  blackoutStartTime?: string;
  blackoutEndDow?: number;
  blackoutEndTime?: string;
  // Explicit, because "clear the window" and "leave the window alone" both look
  // like four absent fields otherwise.
  clearBlackout?: boolean;
}

export function fetchGuardrails(): Promise<GuardrailsData> {
  return apiRequest<GuardrailsData>("/api/guardrails");
}

export function updateGuardrails(body: GuardrailsUpdate): Promise<GuardrailsData> {
  return apiRequest<GuardrailsData>("/api/guardrails", { method: "PATCH", body });
}

export function useGuardrails() {
  return useQuery({ queryKey: ["guardrails"], queryFn: fetchGuardrails, refetchInterval: 60_000 });
}

export function useUpdateGuardrails() {
  return useMutation({ mutationKey: ["guardrails", "update"], mutationFn: updateGuardrails });
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// ISO day of week, 1 = Monday, matching the backend and EXTRACT(ISODOW).
export function dayName(dow: number): string {
  return DAY_NAMES[dow - 1] ?? String(dow);
}
