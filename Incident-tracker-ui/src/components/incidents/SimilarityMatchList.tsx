import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSimilarityMatches } from "../../api/incidents/detail";
import type { IncidentDetail } from "../../api/incidents/detail";
import {
  BUTTON_SECONDARY,
  METER_FILL,
  METER_TRACK,
  MUTED_NOTE,
  SECTION,
  SECTION_TITLE,
} from "../shared/sectionStyles";

interface SimilarityMatchListProps {
  incidentId: string;
  matches: IncidentDetail["similarityMatches"];
}

const INITIAL_CAP = 5;

// FR-066/P-4: the detail endpoint sends only the top five by score; "show all" lazily fetches the
// uncapped list from its own endpoint rather than re-slicing a client-side array that was never
// more than five items long.
export function SimilarityMatchList({ incidentId, matches }: SimilarityMatchListProps) {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["incidents", incidentId, "similarity-matches"],
    queryFn: () => fetchSimilarityMatches(incidentId),
    enabled: showAll,
  });

  if (matches.length === 0) {
    return (
      <p className={`${SECTION} ${MUTED_NOTE} shadow-xs`}>No similar incidents or runbooks found.</p>
    );
  }

  const source = showAll && data ? data.matches : matches;
  const visible = [...source].sort((a, b) => b.score - a.score);

  return (
    <section aria-label="Similarity matches" className={`${SECTION} shadow-xs`}>
      {/*
        Not a heading: each match title is the h3 in this section (asserted by its tests, and the
        right hierarchy — the section's own name comes from its aria-label above).
      */}
      <p className={SECTION_TITLE}>Similar incidents &amp; runbooks</p>
      <ul className="grid gap-2">
        {visible.map((match) => (
          <li
            key={match.id}
            className="grid gap-1.5 rounded-md border border-border-soft bg-secondary p-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {match.documentType}
              </span>
              <h3 className="text-[13px] font-medium">{match.title}</h3>
              <span className="ml-auto font-mono text-[11.5px] text-subtle-foreground">
                {match.score.toFixed(2)}
              </span>
            </div>
            <div
              role="img"
              aria-label={`Match score ${match.score.toFixed(2)}`}
              className={METER_TRACK}
            >
              {/* Score is the datum, so the width stays an inline style. */}
              <div style={{ width: `${match.score * 100}%` }} className={METER_FILL} />
            </div>
            <p className="text-[12.5px] text-muted-foreground">{match.summarySnippet}</p>
            <a
              href={match.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit text-[12px] text-p3 underline underline-offset-2"
            >
              View source
            </a>
          </li>
        ))}
      </ul>
      {!showAll && matches.length >= INITIAL_CAP && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className={`${BUTTON_SECONDARY} mt-2`}
        >
          Show all
        </button>
      )}
      {showAll && isLoading && <p className={`${MUTED_NOTE} mt-2`}>Loading all matches…</p>}
      {showAll && isError && (
        <div
          role="alert"
          className="mt-2 grid gap-2 rounded-md border border-bad/20 bg-chip-bad-bg p-2.5"
        >
          <p className="text-[12.5px] text-bad">
            {(error as Error | undefined)?.message ?? "Could not load all matches."}
          </p>
          <button onClick={() => refetch()} className={BUTTON_SECONDARY}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
