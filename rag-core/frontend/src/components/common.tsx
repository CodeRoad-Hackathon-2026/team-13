import { useEffect, useState } from "react";
import type { Groundedness, RetrievalMode, SearchResult } from "../api/types";
import { getApiKey, setApiKey } from "../api/client";

/** Gate that blocks the app until an API key is present. */
export function ApiKeyGate({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState(getApiKey());
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => {
      setDraft(getApiKey());
      setOpen(true);
    };
    window.addEventListener("rag:settings", handler);
    return () => window.removeEventListener("rag:settings", handler);
  }, []);

  const save = () => {
    setApiKey(draft);
    setKey(draft.trim());
    setOpen(false);
  };

  if (!key || open) {
    return (
      <div className="overlay">
        <div className="modal">
          <h2>RAG service key</h2>
          <p className="muted small">
            This is <strong>this service's own key</strong> — it starts with{" "}
            <code>rag_sk_</code> and is set by <code>BOOTSTRAP_API_KEY</code> in{" "}
            <code>.env</code>.
          </p>
          <p className="muted small">
            <strong>Not</strong> your OpenAI / Anthropic / Voyage key. Vendor
            keys live server-side in <code>.env</code> and never reach the
            browser — pasting one here just fails with{" "}
            <em>invalid API key</em>.
          </p>
          <p className="muted small">
            Sent as <code>X-API-Key</code> on every request and stored in this
            browser's localStorage — visible to anyone with access to this
            browser, which is fine for a demo and not for a public deployment.
          </p>
          <input
            autoFocus
            type="password"
            placeholder="rag_sk_..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
            {key && <button onClick={() => setOpen(false)}>Cancel</button>}
            <button className="primary" onClick={save} disabled={!draft.trim()}>
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row small muted">
      <span className="spin" /> {label}
    </span>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert error">
      <strong>Request failed</strong>
      <span className="small">{String((error as Error).message ?? error)}</span>
    </div>
  );
}

export function ModeBadge({ mode }: { mode: RetrievalMode }) {
  const cls = mode === "hybrid" ? "badge hybrid" : "badge";
  const title =
    mode === "hybrid"
      ? "Found by both the vector and the lexical branch"
      : mode === "vector"
        ? "Found only by semantic similarity"
        : "Found only by full-text match";
  return (
    <span className={cls} title={title}>
      {mode}
    </span>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const cls = value >= 0.6 ? "badge ok" : value >= 0.35 ? "badge warn" : "badge bad";
  return (
    <span
      className={cls}
      title="Relevance of the best retrieved passage. Below MIN_CONTEXT_SCORE the service abstains."
    >
      confidence {value.toFixed(2)}
    </span>
  );
}

export function GroundednessBadge({ value }: { value: Groundedness | null }) {
  if (!value) return null;
  const cls =
    value.verdict === "grounded"
      ? "badge ok"
      : value.verdict === "unknown"
        ? "badge"
        : value.verdict === "partially_grounded"
          ? "badge warn"
          : "badge bad";
  const score = typeof value.score === "number" ? ` ${value.score.toFixed(2)}` : "";
  return (
    <span className={cls} title={value.reasoning ?? value.error ?? ""}>
      {value.verdict.replace("_", " ")}
      {score}
    </span>
  );
}

/**
 * Score breakdown. Rendering all four components is what makes a silent
 * degradation visible: if every result shows an empty lexical bar, the
 * full-text branch has stopped contributing and hybrid search is vector-only.
 */
export function ScoreBars({ result }: { result: SearchResult }) {
  const { vector, lexical, rrf, rerank } = result.scores;
  // RRF is bounded by (vector_weight + lexical_weight) / (k + 1) = 2/61.
  const rows: Array<[string, number | null, string]> = [
    ["vector", vector, ""],
    ["lexical", lexical, "lex"],
    ["rrf", rrf / (2 / 61), "rrf"],
    ["rerank", rerank, "rr"],
  ];
  return (
    <div style={{ marginTop: 8 }}>
      {rows.map(([label, value, cls]) => (
        <div className="scorebar" key={label}>
          <span className="label">{label}</span>
          <span className="track">
            <span
              className={`fill ${cls}`}
              style={{ width: `${Math.min(Math.max(value ?? 0, 0), 1) * 100}%` }}
            />
          </span>
          <span className="val">{value === null ? "—" : value.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

export function MetadataChips({ metadata }: { metadata: Record<string, unknown> }) {
  const hidden = new Set(["collection", "external_id", "title", "heading_path"]);
  const entries = Object.entries(metadata ?? {}).filter(
    ([k, v]) => !hidden.has(k) && v !== null && v !== "",
  );
  if (!entries.length) return null;
  return (
    <div className="chips" style={{ marginTop: 8 }}>
      {entries.slice(0, 8).map(([k, v]) => (
        <span className="chip" key={k}>
          {k}={Array.isArray(v) ? v.join(",") : String(v)}
        </span>
      ))}
    </div>
  );
}

/** Key/value filter builder producing the JSONB containment object. */
export function FilterBuilder({
  filters,
  onChange,
}: {
  filters: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [k, setK] = useState("");
  const [v, setV] = useState("");

  const add = () => {
    if (!k.trim() || !v.trim()) return;
    onChange({ ...filters, [k.trim()]: v.trim() });
    setK("");
    setV("");
  };

  return (
    <div>
      <div className="row">
        <input
          style={{ flex: 1 }}
          placeholder="metadata key (e.g. service)"
          value={k}
          onChange={(e) => setK(e.target.value)}
        />
        <input
          style={{ flex: 1 }}
          placeholder="value (e.g. payments-api)"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add}>Add</button>
      </div>
      {Object.keys(filters).length > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          {Object.entries(filters).map(([key, value]) => (
            <span
              className="chip"
              key={key}
              style={{ cursor: "pointer" }}
              title="Remove"
              onClick={() => {
                const next = { ...filters };
                delete next[key];
                onChange(next);
              }}
            >
              {key}={value} ✕
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function CollectionPicker({
  collections,
  selected,
  onChange,
}: {
  collections: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="chips">
      {collections.map((name) => {
        const on = selected.includes(name);
        return (
          <span
            key={name}
            className="chip"
            style={{
              cursor: "pointer",
              borderColor: on ? "var(--accent)" : undefined,
              color: on ? "var(--text)" : undefined,
            }}
            onClick={() =>
              onChange(on ? selected.filter((c) => c !== name) : [...selected, name])
            }
          >
            {name}
          </span>
        );
      })}
      {selected.length > 0 && (
        <span
          className="chip"
          style={{ cursor: "pointer" }}
          onClick={() => onChange([])}
        >
          clear
        </span>
      )}
    </div>
  );
}
