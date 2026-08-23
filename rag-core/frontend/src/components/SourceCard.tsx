import { forwardRef, useState } from "react";
import type { SearchResult } from "../api/types";
import { api } from "../api/client";
import { MetadataChips, ModeBadge, ScoreBars } from "./common";

interface Props {
  result: SearchResult;
  index?: number;
  cited?: boolean;
  flash?: boolean;
  queryLogId?: string | null;
  showScores?: boolean;
}

export const SourceCard = forwardRef<HTMLDivElement, Props>(function SourceCard(
  { result, index, cited, flash, queryLogId, showScores = true },
  ref,
) {
  const [rated, setRated] = useState<-1 | 1 | null>(null);
  const [busy, setBusy] = useState(false);

  const rate = async (rating: -1 | 1) => {
    setBusy(true);
    try {
      await api.feedback({
        chunk_id: result.chunk_id,
        query_log_id: queryLogId ?? undefined,
        rating,
      });
      setRated(rating);
    } catch {
      /* a failed rating must not break the page */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={ref}
      className={`source${cited ? " cited" : ""}${flash ? " flash" : ""}`}
      id={`src-${result.chunk_id}`}
    >
      <header>
        {index !== undefined && <span className="idx">{index}</span>}
        <span className="title" title={result.title ?? result.external_id}>
          {result.title ?? result.external_id}
        </span>
        <ModeBadge mode={result.retrieval_mode} />
      </header>

      <div className="row small muted" style={{ gap: 6 }}>
        <span className="mono">{result.collection}</span>
        <span>/</span>
        <span className="mono" style={{ wordBreak: "break-all" }}>
          {result.external_id}
        </span>
        {result.uri && (
          <a
            className="small"
            href={result.uri}
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: "auto" }}
          >
            open
          </a>
        )}
      </div>

      {showScores && <ScoreBars result={result} />}
      <MetadataChips metadata={result.metadata} />

      <pre>{result.content}</pre>

      <div className="row" style={{ marginTop: 10, gap: 6 }}>
        <button
          className="small"
          disabled={busy || rated !== null}
          onClick={() => rate(1)}
          title="This passage helped — raises its ranking on later searches"
          style={{ padding: "4px 10px", color: rated === 1 ? "var(--ok)" : undefined }}
        >
          ▲ helpful
        </button>
        <button
          className="small"
          disabled={busy || rated !== null}
          onClick={() => rate(-1)}
          title="Irrelevant or misleading — lowers its ranking"
          style={{ padding: "4px 10px", color: rated === -1 ? "var(--bad)" : undefined }}
        >
          ▼ not useful
        </button>
        {rated !== null && <span className="small muted">recorded</span>}
      </div>
    </div>
  );
});
