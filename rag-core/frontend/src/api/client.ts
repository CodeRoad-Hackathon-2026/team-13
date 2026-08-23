import type {
  AnswerResponse,
  Collection,
  Health,
  IngestResponse,
  Job,
  Prompt,
  PromptDefinition,
  PromptVersion,
  SearchResponse,
  Secret,
  Source,
  SourceRun,
  SourceTypes,
  Stats,
  TestResult,
  Trace,
} from "./types";

const BASE = "/v1";
const KEY_STORAGE = "rag.apiKey";

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? "";
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function authHeaders(): HeadersInit {
  return { "Content-Type": "application/json", "X-API-Key": getApiKey() };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });

  if (!response.ok) {
    // Surface the API's own message — "collection does not exist" is
    // actionable, a bare 422 is not.
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail ?? body);
    } catch {
      /* non-JSON error body; keep the status text */
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

export interface SearchParams {
  query: string;
  collections?: string[] | null;
  filters?: Record<string, string>;
  top_k?: number;
  rerank?: boolean;
}

export interface AnswerParams {
  query: string;
  collections?: string[] | null;
  filters?: Record<string, string>;
  top_k?: number;
  agent_id?: string;
  incident_id?: string;
}

export const api = {
  health: () => request<Health>("/health"),

  collections: () => request<Collection[]>("/collections"),

  createCollection: (name: string, description?: string) =>
    request<Collection>("/collections", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),

  search: (params: SearchParams) =>
    request<SearchResponse>("/search", {
      method: "POST",
      body: JSON.stringify({ rerank: true, top_k: 8, ...params }),
    }),

  answer: (params: AnswerParams) =>
    request<AnswerResponse>("/answer", {
      method: "POST",
      body: JSON.stringify({ top_k: 8, ...params }),
    }),

  feedback: (body: {
    chunk_id?: string;
    query_log_id?: string | null;
    rating: -1 | 0 | 1;
    reason?: string;
    agent_id?: string;
  }) =>
    request<{ id: string; recorded: boolean }>("/feedback", {
      method: "POST",
      body: JSON.stringify({ agent_id: "web-ui", ...body }),
    }),

  ingest: (document: {
    collection: string;
    external_id: string;
    content: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }) =>
    request<IngestResponse>("/documents", {
      method: "POST",
      body: JSON.stringify({
        mode: "async",
        documents: [{ source_type: "web-ui", ...document }],
      }),
    }),

  job: (id: string) => request<Job>(`/jobs/${id}`),

  sources: () => request<Source[]>("/sources"),

  syncSource: (id: string) =>
    request<{ job_id: string }>(`/sources/${id}/sync`, { method: "POST" }),

  // ------------------------------------------------------------ connectors
  sourceTypes: () => request<SourceTypes>("/source-types"),

  createSource: (body: {
    collection: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    interval_seconds: number;
    enabled: boolean;
  }) =>
    request<Source>("/sources", { method: "POST", body: JSON.stringify(body) }),

  /** Edit in place. POST /sources upserts on (collection, name) and so cannot rename. */
  updateSource: (
    id: string,
    body: Partial<{
      collection: string;
      name: string;
      type: string;
      config: Record<string, unknown>;
      interval_seconds: number;
      enabled: boolean;
    }>,
  ) => request<Source>(`/sources/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  testSource: (type: string, config: Record<string, unknown>) =>
    request<TestResult>("/sources/test", {
      method: "POST",
      body: JSON.stringify({ type, config }),
    }),

  deleteSource: (id: string) =>
    request<{ deleted: string }>(`/sources/${id}`, { method: "DELETE" }),

  sourceRuns: (id: string, limit = 20) =>
    request<SourceRun[]>(`/sources/${id}/runs?limit=${limit}`),

  // --------------------------------------------------------------- secrets
  secrets: () => request<Secret[]>("/secrets"),

  createSecret: (body: { name: string; value: string; description?: string }) =>
    request<Secret>("/secrets", { method: "POST", body: JSON.stringify(body) }),

  deleteSecret: (name: string) =>
    request<{ deleted: string }>(`/secrets/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

  // --------------------------------------------------------------- prompts
  prompts: () =>
    request<{ definitions: PromptDefinition[]; prompts: Prompt[] }>("/prompts"),

  promptVersions: (key: string, collection?: string | null) =>
    request<{ versions: PromptVersion[] }>(
      `/prompts/${key}/versions${collection ? `?collection=${encodeURIComponent(collection)}` : ""}`,
    ),

  savePrompt: (
    key: string,
    body: { body: string; collection?: string | null; note?: string },
  ) =>
    request<{ id: string; version: number; unchanged?: boolean }>(
      `/prompts/${key}`,
      { method: "PUT", body: JSON.stringify({ created_by: "web-ui", ...body }) },
    ),

  activatePromptVersion: (versionId: string) =>
    request<{ id: string; version: number }>(
      `/prompts/versions/${versionId}/activate`,
      { method: "POST" },
    ),

  resetPrompt: (key: string, collection?: string | null) =>
    request<{ id: string; version: number }>(
      `/prompts/${key}/reset${collection ? `?collection=${encodeURIComponent(collection)}` : ""}`,
      { method: "POST" },
    ),

  // ---------------------------------------------------------------- traces
  stats: (days = 7) => request<Stats>(`/admin/stats?days=${days}`),

  trace: (id: string) => request<Trace>(`/traces/${id}`),

  pinTrace: (id: string, reason?: string) =>
    request<{ pinned: boolean }>(`/traces/${id}/pin`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  unpinTrace: (id: string) =>
    request<{ pinned: boolean }>(`/traces/${id}/pin`, { method: "DELETE" }),

  incidentTraces: (incidentId: string) =>
    request<{ incident_id: string; count: number; traces: Trace[] }>(
      `/incidents/${encodeURIComponent(incidentId)}/traces`,
    ),
};
