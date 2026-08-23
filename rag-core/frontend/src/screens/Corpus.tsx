import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Collection, Job, Source } from "../api/types";
import { ErrorBox, Spinner } from "../components/common";

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="badge">never run</span>;
  const cls = status === "ok" ? "badge ok" : status === "error" ? "badge bad" : "badge";
  return <span className={cls}>{status}</span>;
}

export default function Corpus() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cs, ss] = await Promise.all([api.collections(), api.sources()]);
      setCollections(cs);
      setSources(ss);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <ErrorBox error={error} />

      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Collections</h2>
          <button style={{ marginLeft: "auto" }} onClick={load}>
            Refresh
          </button>
        </div>
        {loading ? (
          <Spinner label="loading…" />
        ) : (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Documents</th>
                <th>Chunks</th>
                <th>Embedding model</th>
                <th>Dim</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.name}</td>
                  <td>{c.document_count}</td>
                  <td>{c.chunk_count}</td>
                  <td className="mono small">{c.embedding_model}</td>
                  <td className="small">{c.embedding_dim}</td>
                </tr>
              ))}
              {collections.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No collections yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Sources</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Polled on their interval by the worker. A failing connector never
          blocks the others — the error is recorded here.
        </p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Collection</th>
              <th>Every</th>
              <th>Status</th>
              <th>Last run</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.name}</td>
                <td className="small">{s.type}</td>
                <td className="small">{s.collection}</td>
                <td className="small">{s.interval_seconds}s</td>
                <td>
                  <StatusBadge status={s.last_status} />
                  {s.last_error && (
                    <div className="small" style={{ color: "var(--bad)", marginTop: 4 }}>
                      {s.last_error}
                    </div>
                  )}
                </td>
                <td className="small muted">
                  {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "—"}
                </td>
                <td>
                  <button
                    className="small"
                    style={{ padding: "4px 10px" }}
                    onClick={async () => {
                      try {
                        await api.syncSource(s.id);
                        setTimeout(load, 2500);
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Sync now
                  </button>
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No sources registered. See docs/sources.md.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <IngestPanel collections={collections} onDone={load} />
    </div>
  );
}

function IngestPanel({
  collections,
  onDone,
}: {
  collections: Collection[];
  onDone: () => void;
}) {
  const [collection, setCollection] = useState("");
  const [externalId, setExternalId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!collection && collections.length) setCollection(collections[0].name);
  }, [collections, collection]);

  // Poll the job until it settles — ingestion is async through the worker.
  useEffect(() => {
    if (!job || job.status === "succeeded" || job.status === "failed") return;
    const timer = setTimeout(async () => {
      try {
        setJob(await api.job(job.id));
      } catch {
        /* keep the last known state */
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [job]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const response = await api.ingest({
        collection,
        external_id: externalId.trim(),
        content,
        title: title.trim() || undefined,
        metadata: { via: "web-ui" },
      });
      if (response.job_ids.length) {
        setJob(await api.job(response.job_ids[0]));
      }
      setContent("");
      setExternalId("");
      setTitle("");
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Add a document</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Idempotent on <code>(collection, external_id)</code> — re-submitting the
        same content is a no-op, changed content replaces it.
      </p>
      <ErrorBox error={error} />
      <div className="row">
        <select
          style={{ flex: "0 0 200px" }}
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
        >
          {collections.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          style={{ flex: 1 }}
          placeholder="external_id (e.g. runbook/redis-evictions)"
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
        />
        <input
          style={{ flex: 1 }}
          placeholder="title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <textarea
        rows={8}
        style={{ marginTop: 10 }}
        placeholder={"# Markdown\n\n## Symptom\n...\n\n## Mitigation\n..."}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="primary"
          onClick={submit}
          disabled={busy || !collection || !externalId.trim() || !content.trim()}
        >
          Ingest
        </button>
        {job && (
          <span className="row small">
            <span className="mono muted">{job.id.slice(0, 8)}</span>
            <span
              className={
                job.status === "succeeded"
                  ? "badge ok"
                  : job.status === "failed"
                    ? "badge bad"
                    : "badge"
              }
            >
              {job.status}
            </span>
            {job.result != null && (
              <span className="muted">
                {String((job.result as Record<string, unknown>).status)} ·{" "}
                {String((job.result as Record<string, unknown>).chunk_count)} chunks
              </span>
            )}
            {job.error && <span style={{ color: "var(--bad)" }}>{job.error}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
