/** Wire types mirroring app/schemas.py and the to_dict() shapes. */

export interface ScoreBreakdown {
  vector: number | null;
  lexical: number | null;
  rrf: number;
  rerank: number | null;
  feedback: number;
}

export type RetrievalMode = "hybrid" | "vector" | "lexical";

export interface SearchResult {
  chunk_id: string;
  document_id: string;
  collection: string;
  external_id: string;
  title: string | null;
  uri: string | null;
  source_type: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  scores: ScoreBreakdown;
  retrieval_mode: RetrievalMode;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  took_ms: number;
}

export interface Citation {
  marker: number;
  chunk_id: string;
  document_id: string;
  collection: string;
  external_id: string;
  title: string | null;
  uri: string | null;
  score: number;
}

export interface Groundedness {
  score: number | null;
  verdict: "grounded" | "partially_grounded" | "ungrounded" | "unknown";
  unsupported_claims?: string[];
  reasoning?: string;
  error?: string;
}

export interface AnswerResponse {
  query_log_id: string | null;
  answer: string;
  /** Not an error: the corpus cannot support an answer. */
  abstained: boolean;
  abstain_reason: string | null;
  confidence: number;
  citations: Citation[];
  sources: SearchResult[];
  groundedness: Groundedness | null;
  model: string | null;
  latency_ms: number;
  warnings: string[];
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  embedding_model: string;
  embedding_dim: number;
  document_count: number;
  chunk_count: number;
  created_at: string;
}

export interface Source {
  id: string;
  collection: string;
  name: string;
  type: string;
  interval_seconds: number;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  /** Redacted: `${NAME}` references survive, literal credentials are masked. */
  config: Record<string, unknown>;
  next_run_at: string | null;
}

export type FieldType =
  | "text"
  | "secret"
  | "number"
  | "boolean"
  | "textarea"
  | "list"
  | "keyvalue"
  | "select";

export interface ConnectorField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  default: unknown;
  help: string;
  placeholder: string;
  options: string[];
  advanced: boolean;
}

export interface ConnectorSpec {
  name: string;
  label: string;
  description: string;
  docs: string;
  fields: ConnectorField[];
  testable: boolean;
}

export interface SourceTypes {
  vault_enabled: boolean;
  types: ConnectorSpec[];
}

export interface TestResult {
  ok: boolean;
  message: string;
  detail: Record<string, unknown>;
}

export interface SourceRun {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  documents: number;
  indexed: number;
  unchanged: number;
  failed: number;
  error: string | null;
}

export interface Secret {
  name: string;
  description: string | null;
  /** Last four characters. The value itself is never returned by the API. */
  hint: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  used_by: string[];
}

export interface PromptDefinition {
  key: string;
  label: string;
  description: string;
  default: string;
  required_placeholders: string[];
}

export interface Prompt {
  id: string;
  key: string;
  collection: string | null;
  label: string;
  description: string;
  required_placeholders: string[];
  version_id: string | null;
  version: number | null;
  body: string;
  note: string | null;
  created_at: string | null;
  created_by: string | null;
  version_count: number;
  is_default: boolean;
}

export interface PromptVersion {
  id: string;
  version: number;
  body: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  is_active: boolean;
}

export interface IngestResponse {
  accepted: number;
  mode: string;
  job_ids: string[];
  results: Array<Record<string, unknown>>;
}

export interface Job {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface Stats {
  window_days: number;
  corpus: { collections: number; documents: number; chunks: number };
  quality: {
    queries: number;
    abstentions: number;
    avg_latency_ms: number | null;
    avg_groundedness: number | null;
  };
  feedback: { total: number; positive: number; negative: number };
}

export interface Health {
  status: string;
  checks: Record<string, string>;
  providers: { embeddings: string; llm: string; rerank: string };
}

export interface Trace {
  id: string;
  query: string;
  incident_id: string | null;
  agent_id: string | null;
  collections: string[];
  filters: Record<string, unknown>;
  retrieved: SearchResult[];
  answer: string | null;
  citations: Citation[];
  abstained: boolean;
  abstain_reason: string | null;
  groundedness: Groundedness | null;
  llm_model: string | null;
  embedding_model: string | null;
  latency_ms: number | null;
  created_at: string;
  pinned?: boolean;
  pinned_at?: string | null;
  pin_reason?: string | null;
  prompt_versions?: Record<string, { version: number; version_id: string; scope: string }>;
}
