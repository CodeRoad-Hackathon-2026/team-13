import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { fetchAgentRunIO } from "../../api/incidents/detail";
import type { IncidentDetail } from "../../api/incidents/detail";
import {
  ALERT_NOTE,
  CODE_BLOCK,
  DISCLOSURE,
  MUTED_NOTE,
  SECTION,
  SECTION_TITLE,
} from "../shared/sectionStyles";

interface AgentRunTraceProps {
  incidentId: string;
  runs: IncidentDetail["agentRuns"];
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function AgentRunEntry({
  incidentId,
  run,
}: {
  incidentId: string;
  run: IncidentDetail["agentRuns"][number];
}) {
  // FR-065: failed runs start expanded with the error visible; every other run starts collapsed.
  const [expanded, setExpanded] = useState(run.hasError);
  // P-4: input/output are JSONB and only fetched once this run is expanded, never eagerly.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["incidents", incidentId, "agent-runs", run.id, "io"],
    queryFn: () => fetchAgentRunIO(incidentId, run.id),
    enabled: expanded,
  });

  return (
    // FR-065: a failed run is tinted *and* carries the "Error" text label (A11Y-1).
    <li
      data-error={run.hasError}
      className="rounded-md border border-border-soft bg-secondary p-2.5 transition-colors hover:bg-muted/60 data-[error=true]:border-bad/20 data-[error=true]:bg-chip-bad-bg data-[error=true]:hover:bg-chip-bad-bg"
    >
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={`${DISCLOSURE} font-semibold text-foreground`}
        >
          <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
          {run.agentName} v{run.agentVersion}
        </button>
        <span className="text-muted-foreground">{run.status}</span>
        <span className="font-mono text-[11.5px] text-subtle-foreground">
          {formatDuration(run.latencyMs)}
        </span>
        <span className="font-mono text-[11.5px] text-subtle-foreground">
          {run.confidenceScore != null ? run.confidenceScore.toFixed(2) : "—"}
        </span>
        {run.hasError && (
          <span
            data-error="true"
            className="rounded bg-bad px-1.5 py-px text-[10.5px] font-bold uppercase text-white"
          >
            Error
          </span>
        )}
      </div>
      {expanded && (
        <div className="mt-2 grid gap-2">
          {isLoading && <p className={MUTED_NOTE}>Loading input/output…</p>}
          {isError && (
            <p role="alert" className={ALERT_NOTE}>
              Could not load input/output.
            </p>
          )}
          {data && (
            <>
              <pre className={CODE_BLOCK}>{JSON.stringify(data.input, null, 2)}</pre>
              <pre className={CODE_BLOCK}>{JSON.stringify(data.output, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </li>
  );
}

// FR-064: agent runs in start order, with name/version, status, duration, confidence, and
// input/output collapsible per-run (fetched lazily on expand, per P-4).
export function AgentRunTrace({ incidentId, runs }: AgentRunTraceProps) {
  if (runs.length === 0) {
    return (
      <p className={`${SECTION} ${MUTED_NOTE} shadow-xs`}>No agent runs recorded for this incident.</p>
    );
  }

  return (
    <section aria-label="Agent run trace" className={`${SECTION} shadow-xs`}>
      <h3 className={SECTION_TITLE}>Agent run trace</h3>
      <ol className="grid gap-1.5">
        {runs.map((run) => (
          <AgentRunEntry key={run.id} incidentId={incidentId} run={run} />
        ))}
      </ol>
    </section>
  );
}
