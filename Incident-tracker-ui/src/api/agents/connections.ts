import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";

export interface ConnectionSource {
  id: string;
  name: string;
  type: string;
  collection: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  // "ok" | "error" | null. null means it has never run — deliberately not folded
  // into "error", because a source nobody has polled yet is not a broken one.
  lastStatus: string | null;
  lastError: string | null;
}

export interface ConnectionsData {
  sources: ConnectionSource[];
  // Set when RAG Core did not answer. The panel says so instead of rendering an
  // empty list, which would read as "no sources configured".
  unavailable: string | null;
}

export function fetchConnections(): Promise<ConnectionsData> {
  return apiRequest<ConnectionsData>("/api/connections");
}

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
    queryFn: fetchConnections,
    refetchInterval: 120_000,
  });
}
