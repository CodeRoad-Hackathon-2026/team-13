import { useIncidentList } from "../../api/incidents/list";
import { useUrlState } from "../../state/useUrlState";
import { PanelBoundary } from "../shared/PanelBoundary";
import { Panel } from "../shared/Panel";

// K4/FR-103/FR-104: the learning backlog — same-tab, row-click-opens-drawer list (contracts/
// incidents-endpoints.md's own note: candidate=true is not a cross-tab jump, since this panel
// already lives on a row-click list, not a jump target).
export function DocumentationCandidates() {
  const { setIncident } = useUrlState();
  const { data, isLoading, isError, error, refetch } = useIncidentList({ candidate: true });

  return (
    <Panel title="Documentation candidates">
      <PanelBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={(error as Error | undefined)?.message}
        onRetry={refetch}
        data={data}
        isEmpty={(d) => d.rows.length === 0}
        emptyNoDataMessage="No documentation candidates right now — every resolved incident has a match."
        skeleton={
          <div className="h-[180px] animate-pulse rounded-lg border border-border bg-muted/40">
            <span className="sr-only">Loading documentation candidates…</span>
          </div>
        }
      >
        {(list) => (
          <section
            aria-label="Documentation candidates"
            className="rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <ul>
              {list.rows.map((row) => {
                const open = () => setIncident(row.id);
                return (
                  // K4: row click opens the drawer in place — same tab, never a cross-tab jump.
                  <li
                    key={row.id}
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") open();
                    }}
                    className="-mx-2 flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-t border-border-soft px-2 py-2.5 text-[13px] transition-colors first:border-t-0 hover:bg-muted/60"
                  >
                    <span className="meta">{row.externalId}</span>
                    <span className="min-w-0 flex-1 truncate">{row.title}</span>
                    <span className="text-muted-foreground">{row.serviceName}</span>
                    <span className="rounded bg-muted px-1.5 py-px text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                      {row.candidateReason}
                    </span>
                    {row.recurrenceCount !== null && row.recurrenceCount > 1 && (
                      <span className="text-[12px] font-medium text-warn">
                        Recurred {row.recurrenceCount} times
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </PanelBoundary>
    </Panel>
  );
}
