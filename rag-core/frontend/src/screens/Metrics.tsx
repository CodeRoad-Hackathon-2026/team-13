import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Health, Stats, Trace } from "../api/types";
import { ErrorBox, GroundednessBadge, Spinner } from "../components/common";
import { SourceCard } from "../components/SourceCard";

function Card({ k, v, sub }: { k: string; v: string | number; sub?: string }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Metrics() {
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<unknown>(null);

  const [traceId, setTraceId] = useState(params.get("trace") ?? "");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [traceError, setTraceError] = useState<unknown>(null);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [pinReason, setPinReason] = useState("");

  useEffect(() => {
    Promise.all([api.stats(days), api.health()])
      .then(([s, h]) => {
        setStats(s);
        setHealth(h);
        setError(null);
      })
      .catch(setError);
  }, [days]);

  const loadTrace = async (id: string) => {
    if (!id.trim()) return;
    setLoadingTrace(true);
    setTraceError(null);
    try {
      setTrace(await api.trace(id.trim()));
      setParams({ trace: id.trim() });
    } catch (e) {
      setTraceError(e);
      setTrace(null);
    } finally {
      setLoadingTrace(false);
    }
  };

  useEffect(() => {
    const initial = params.get("trace");
    if (initial) loadTrace(initial);
    // Only on mount: later loads are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abstentionRate =
    stats && stats.quality.queries > 0
      ? (stats.quality.abstentions / stats.quality.queries) * 100
      : 0;

  return (
    <div>
      <ErrorBox error={error} />

      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Corpus</h2>
          <div className="row" style={{ marginLeft: "auto" }}>
            {health && (
              <>
                <span className={health.status === "ok" ? "badge ok" : "badge warn"}>
                  {health.status}
                </span>
                <span className="badge" title="embedding provider">
                  {health.providers.embeddings}
                </span>
                <span className="badge" title="llm provider">
                  {health.providers.llm}
                </span>
                <span className="badge" title="reranker">
                  rerank: {health.providers.rerank}
                </span>
              </>
            )}
          </div>
        </div>
        {stats ? (
          <div className="cards" style={{ marginTop: 12 }}>
            <Card k="Collections" v={stats.corpus.collections} />
            <Card k="Documents" v={stats.corpus.documents} />
            <Card k="Chunks" v={stats.corpus.chunks} />
          </div>
        ) : (
          <Spinner label="loading…" />
        )}
      </div>

      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Answer quality</h2>
          <select
            style={{ width: 130, marginLeft: "auto" }}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>last 24h</option>
            <option value={7}>last 7 days</option>
            <option value={30}>last 30 days</option>
          </select>
        </div>
        {stats && (
          <div className="cards" style={{ marginTop: 12 }}>
            <Card k="Queries" v={stats.quality.queries} />
            <Card
              k="Abstention rate"
              v={`${abstentionRate.toFixed(0)}%`}
              sub={`${stats.quality.abstentions} refused to answer`}
            />
            <Card
              k="Avg groundedness"
              v={
                stats.quality.avg_groundedness != null
                  ? stats.quality.avg_groundedness.toFixed(2)
                  : "—"
              }
              sub={stats.quality.avg_groundedness == null ? "judge disabled" : undefined}
            />
            <Card
              k="Avg latency"
              v={stats.quality.avg_latency_ms != null ? `${stats.quality.avg_latency_ms} ms` : "—"}
            />
            <Card
              k="Feedback"
              v={stats.feedback.total}
              sub={`${stats.feedback.positive} up · ${stats.feedback.negative} down`}
            />
          </div>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>
          A non-zero abstention rate is healthy: it means the confidence gate is
          firing on questions the corpus cannot answer. A rate near zero on a
          small corpus usually means the threshold is too low.
        </p>
      </div>

      <div className="panel">
        <h2>Trace</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Every query persists its candidates, scores, answer and verdict. This
          is how you debug a bad answer instead of guessing.
        </p>
        <div className="row">
          <input
            style={{ flex: 1 }}
            placeholder="query_log_id"
            value={traceId}
            onChange={(e) => setTraceId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadTrace(traceId)}
          />
          <button onClick={() => loadTrace(traceId)} disabled={loadingTrace}>
            Load
          </button>
        </div>
        <ErrorBox error={traceError} />
        {loadingTrace && <Spinner label="loading trace…" />}

        {trace && (
          <div style={{ marginTop: 14 }}>
            <div className="row">
              <span className="badge">{new Date(trace.created_at).toLocaleString()}</span>
              {trace.abstained ? (
                <span className="badge warn">abstained: {trace.abstain_reason}</span>
              ) : (
                <GroundednessBadge value={trace.groundedness} />
              )}
              {trace.llm_model && <span className="badge">{trace.llm_model}</span>}
              {trace.latency_ms != null && (
                <span className="badge">{trace.latency_ms} ms</span>
              )}
              {trace.incident_id && (
                <span className="badge">incident {trace.incident_id}</span>
              )}
              {trace.pinned && <span className="badge ok">pinned</span>}
              {Object.entries(trace.prompt_versions ?? {})
                .filter(([, v]) => v.version > 1)
                .map(([key, v]) => (
                  <span
                    key={key}
                    className="badge warn"
                    title="This answer was produced by an edited prompt, not the shipped default."
                  >
                    {key} v{v.version}
                  </span>
                ))}
              <span className="spacer" />
              <button
                className="small"
                onClick={async () => {
                  if (trace.pinned) await api.unpinTrace(trace.id);
                  else
                    await api.pinTrace(
                      trace.id,
                      pinReason.trim() || undefined,
                    );
                  await loadTrace(trace.id);
                }}
              >
                {trace.pinned ? "Unpin" : "Pin"}
              </button>
            </div>

            {!trace.pinned ? (
              <div className="row" style={{ marginTop: 8 }}>
                <input
                  style={{ flex: 1 }}
                  className="small"
                  placeholder="Why keep it — a PR URL, a postmortem link"
                  value={pinReason}
                  onChange={(e) => setPinReason(e.target.value)}
                />
              </div>
            ) : (
              trace.pin_reason && (
                <p className="muted small">pinned for: {trace.pin_reason}</p>
              )
            )}
            <p className="muted small">
              Unpinned traces are deleted after the retention window. Pin any
              trace a PR or postmortem links to, or that link will 404 exactly
              when someone audits the decision.
            </p>

            <h3>Query</h3>
            <div className="mono">{trace.query}</div>

            {trace.answer && (
              <>
                <h3>Answer</h3>
                <div className="answer small" style={{ whiteSpace: "pre-wrap" }}>
                  {trace.answer}
                </div>
              </>
            )}

            <h3>Retrieved · {trace.retrieved?.length ?? 0}</h3>
            {(trace.retrieved ?? []).map((r, i) => (
              <SourceCard key={r.chunk_id} result={r} index={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
