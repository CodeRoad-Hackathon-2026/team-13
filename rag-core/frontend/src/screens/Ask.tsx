import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api/client";
import { streamAnswer } from "../api/stream";
import type { AnswerResponse, SearchResult } from "../api/types";
import {
  CollectionPicker,
  ConfidenceBadge,
  ErrorBox,
  FilterBuilder,
  GroundednessBadge,
  Spinner,
} from "../components/common";
import { SourceCard } from "../components/SourceCard";

/**
 * Renders the answer, turning [n] markers into clickable chips.
 *
 * The markers are replaced before markdown parsing, using a placeholder that
 * markdown will not touch, then swapped back in the text renderer. Doing it
 * after parsing would mean walking the AST for text nodes that markdown may
 * have already split across elements.
 */
function AnswerBody({
  text,
  onCite,
}: {
  text: string;
  onCite: (marker: number) => void;
}) {
  const renderText = (value: string) => {
    const parts = value.split(/(\[\d{1,2}\])/g);
    return parts.map((part, i) => {
      const match = /^\[(\d{1,2})\]$/.exec(part);
      if (!match) return <span key={i}>{part}</span>;
      const marker = Number(match[1]);
      return (
        <button
          key={i}
          className="cite"
          onClick={() => onCite(marker)}
          title={`Jump to source ${marker}`}
        >
          {marker}
        </button>
      );
    });
  };

  return (
    <div className="answer">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{mapText(children, renderText)}</p>,
          li: ({ children }) => <li>{mapText(children, renderText)}</li>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Apply a text transform to the string leaves of a React children array. */
function mapText(
  children: React.ReactNode,
  transform: (value: string) => React.ReactNode,
): React.ReactNode {
  return Array.isArray(children)
    ? children.map((child, i) =>
        typeof child === "string" ? <span key={i}>{transform(child)}</span> : child,
      )
    : typeof children === "string"
      ? transform(children)
      : children;
}

export default function Ask() {
  const [query, setQuery] = useState("");
  const [collections, setCollections] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [incidentId, setIncidentId] = useState("");

  const [sources, setSources] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState("");
  const [final, setFinal] = useState<AnswerResponse | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [flashed, setFlashed] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    api
      .collections()
      .then((cs) => setAvailable(cs.map((c) => c.name)))
      .catch(() => setAvailable([]));
  }, []);

  const jumpToSource = useCallback((marker: number) => {
    const el = cardRefs.current[marker];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const id = el.id;
    setFlashed(id);
    setTimeout(() => setFlashed((cur) => (cur === id ? null : cur)), 1200);
  }, []);

  const ask = async () => {
    if (!query.trim() || streaming) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);
    setError(null);
    setSources([]);
    setAnswer("");
    setFinal(null);

    try {
      for await (const event of streamAnswer({
        query: query.trim(),
        collections: collections.length ? collections : null,
        filters,
        incident_id: incidentId.trim() || undefined,
        signal: controller.signal,
      })) {
        switch (event.event) {
          case "sources":
            // Arrives before the first token, so citations can render while
            // the answer is still being written.
            setSources(event.data.sources);
            break;
          case "delta":
            setAnswer((prev) => prev + event.data.text);
            break;
          case "abstained":
            setFinal(event.data);
            setAnswer("");
            break;
          case "final":
            // The trustworthy event: citations validated, judge run.
            setFinal(event.data);
            setAnswer(event.data.answer);
            break;
          case "error":
            setError(new Error(event.data.message));
            break;
          case "done":
            break;
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e);
    } finally {
      setStreaming(false);
    }
  };

  const citedMarkers = new Set((final?.citations ?? []).map((c) => c.marker));
  const shown = final?.sources?.length ? final.sources : sources;

  return (
    <div className="split">
      <div>
        <div className="panel">
          <h2>Ask</h2>
          <textarea
            rows={3}
            placeholder="Describe the symptom — include exact identifiers (error codes, service names); they are matched literally."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
            }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="primary"
              onClick={ask}
              disabled={streaming || !query.trim() || !incidentId.trim()}
            >
              {streaming ? "Answering…" : "Ask  ⌘⏎"}
            </button>
            {streaming && (
              <button onClick={() => abortRef.current?.abort()}>Stop</button>
            )}
            {/* Required by the API (REQUIRE_INCIDENT_ID). Enforced here too so
                the button explains the constraint instead of the request
                failing with a 422 after the user has typed a question. */}
            <input
              style={{ width: 190, marginLeft: "auto" }}
              placeholder="incident id (required)"
              title="Groups every query made for one incident, so the whole investigation can be replayed later."
              value={incidentId}
              onChange={(e) => setIncidentId(e.target.value)}
            />
          </div>

          <h3>Collections</h3>
          <CollectionPicker
            collections={available}
            selected={collections}
            onChange={setCollections}
          />

          <h3>Metadata filters</h3>
          <FilterBuilder filters={filters} onChange={setFilters} />
        </div>

        <div className="panel">
          <ErrorBox error={error} />

          {final?.abstained && (
            <div className="alert abstain">
              <strong>No answer — the corpus cannot support one</strong>
              <span className="small">
                This is a deliberate outcome, not a failure. Reason:{" "}
                <code>{final.abstain_reason}</code>. The retrieved passages are
                below the confidence threshold, so the model was not asked to
                answer. Sources are still listed on the right.
              </span>
            </div>
          )}

          {final && final.warnings.length > 0 && (
            <div className="alert warn">
              <strong>Guardrail warnings</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }} className="small">
                {final.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {(final || answer) && !final?.abstained && (
            <div className="row" style={{ marginBottom: 12 }}>
              {final && <ConfidenceBadge value={final.confidence} />}
              {final && <GroundednessBadge value={final.groundedness} />}
              {final?.model && <span className="badge">{final.model}</span>}
              {final && <span className="badge">{final.latency_ms} ms</span>}
              {final?.query_log_id && (
                <a
                  className="small muted"
                  href={`/metrics?trace=${final.query_log_id}`}
                  style={{ marginLeft: "auto" }}
                >
                  trace →
                </a>
              )}
            </div>
          )}

          {answer ? (
            <>
              <AnswerBody text={answer} onCite={jumpToSource} />
              {streaming && <span className="caret" />}
            </>
          ) : streaming ? (
            <Spinner label="retrieving…" />
          ) : (
            !final && (
              <div className="empty">
                Ask a question to see the answer, its citations and the
                groundedness verdict.
              </div>
            )
          )}
        </div>
      </div>

      <div>
        <div className="panel">
          <h2>
            Sources{" "}
            <span className="muted small">
              {shown.length ? `· ${shown.length}` : ""}
            </span>
          </h2>
          {shown.length === 0 && (
            <div className="empty small">Retrieved passages appear here first.</div>
          )}
          {shown.map((result, i) => (
            <SourceCard
              key={result.chunk_id}
              ref={(el) => {
                cardRefs.current[i + 1] = el;
              }}
              result={result}
              index={i + 1}
              cited={citedMarkers.has(i + 1)}
              flash={flashed === `src-${result.chunk_id}`}
              queryLogId={final?.query_log_id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
