import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { SearchResponse } from "../api/types";
import {
  CollectionPicker,
  ErrorBox,
  FilterBuilder,
  Spinner,
} from "../components/common";
import { SourceCard } from "../components/SourceCard";

export default function Search() {
  const [query, setQuery] = useState("");
  const [collections, setCollections] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [topK, setTopK] = useState(8);
  const [rerank, setRerank] = useState(true);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .collections()
      .then((cs) => setAvailable(cs.map((c) => c.name)))
      .catch(() => setAvailable([]));
  }, []);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.search({
          query: query.trim(),
          collections: collections.length ? collections : null,
          filters,
          top_k: topK,
          rerank,
        }),
      );
    } catch (e) {
      setError(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const modes = data?.results.reduce<Record<string, number>>((acc, r) => {
    acc[r.retrieval_mode] = (acc[r.retrieval_mode] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="panel">
        <h2>Search — retrieval only, no LLM tokens</h2>
        <div className="row">
          <input
            style={{ flex: 1 }}
            placeholder="Mix prose with exact tokens: 'checkout timing out ERR_UPSTREAM_TIMEOUT pgbouncer'"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
          <button className="primary" onClick={run} disabled={loading || !query.trim()}>
            Search
          </button>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <label className="small muted">
            top_k
            <input
              type="number"
              min={1}
              max={50}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              style={{ width: 70, marginLeft: 8, display: "inline-block" }}
            />
          </label>
          <label className="small muted row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={rerank}
              onChange={(e) => setRerank(e.target.checked)}
              style={{ width: "auto" }}
            />
            rerank
          </label>
          {data && (
            <span className="small muted" style={{ marginLeft: "auto" }}>
              {data.results.length} results in {data.took_ms} ms
            </span>
          )}
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
        {loading && <Spinner label="searching…" />}

        {modes && (
          <div className="row" style={{ marginBottom: 12 }}>
            {Object.entries(modes).map(([mode, count]) => (
              <span key={mode} className={mode === "hybrid" ? "badge hybrid" : "badge"}>
                {mode}: {count}
              </span>
            ))}
            {!modes.hybrid && !modes.lexical && (
              <span className="small muted">
                No lexical hits — the full-text branch is not contributing to
                this query.
              </span>
            )}
          </div>
        )}

        {data?.results.length === 0 && (
          <div className="empty">Nothing matched. Try fewer filters.</div>
        )}

        {data?.results.map((result, i) => (
          <SourceCard key={result.chunk_id} result={result} index={i + 1} />
        ))}

        {!data && !loading && (
          <div className="empty">
            Retrieval only — this is the screen that shows whether both branches
            are actually contributing.
          </div>
        )}
      </div>
    </div>
  );
}
