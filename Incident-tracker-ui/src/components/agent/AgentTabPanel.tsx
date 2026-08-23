import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentDetailData } from "../../api/agents/roster";
import { useAgent, useRoster } from "../../api/agents/roster";
import { PanelBoundary } from "../shared/PanelBoundary";
import { AgentDetail } from "./AgentDetail";
import { AgentRoster } from "./AgentRoster";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { GuardrailsPanel } from "./GuardrailsPanel";

// The orchestrator and its agents. Main column plus a narrower rail — the first
// asymmetric layout in the app, because the guardrails and the sources bound
// every agent rather than belonging to the one selected.
export function AgentTabPanel() {
  const roster = useRoster();
  // Only an explicit choice is stored. The default is derived, so the roster
  // arriving does not have to write state from an effect — which would be a
  // cascading render, and would also fight a user who clicked during the fetch.
  //
  // Decision Agent first: it is the only agent that proposes actions, so it is
  // the only one whose policy currently changes anything.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const fallback =
    roster.data?.agents.find((a) => a.name === "Decision Agent") ?? roster.data?.agents[0];
  const selectedId = chosenId ?? fallback?.id ?? null;

  const detail = useAgent(selectedId);

  // Every mutation returns the whole refreshed agent, so a change lands in both
  // caches without a re-read. The roster is invalidated rather than patched: it
  // carries derived run counts this response does not.
  function onChanged(next: AgentDetailData) {
    queryClient.setQueryData(["agents", next.id], next);
    void queryClient.invalidateQueries({ queryKey: ["agents"], exact: true });
  }

  return (
    <div className="grid grid-cols-1 gap-4 pt-[18px] xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <PanelBoundary
          isLoading={roster.isLoading}
          isError={roster.isError}
          errorMessage={(roster.error as Error | undefined)?.message}
          onRetry={roster.refetch}
          data={roster.data}
          isEmpty={(data) => data.agents.length === 0}
          emptyNoDataMessage="No agent is registered, which means the seeds have not run."
          skeleton={
            <div className="h-[280px] animate-pulse rounded-xl border border-border bg-muted/40">
              <span className="sr-only">Loading agents…</span>
            </div>
          }
        >
          {(data) => (
            <AgentRoster roster={data} selectedId={selectedId} onSelect={setChosenId} />
          )}
        </PanelBoundary>

        {selectedId && (
          <PanelBoundary
            isLoading={detail.isLoading}
            isError={detail.isError}
            errorMessage={(detail.error as Error | undefined)?.message}
            onRetry={detail.refetch}
            data={detail.data}
            isEmpty={() => false}
            emptyNoDataMessage="That agent has no configuration yet."
            skeleton={
              <div className="h-[420px] animate-pulse rounded-xl border border-border bg-muted/40">
                <span className="sr-only">Loading agent configuration…</span>
              </div>
            }
          >
            {(data) => <AgentDetail agent={data} onChanged={onChanged} />}
          </PanelBoundary>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <GuardrailsPanel />
        <ConnectionsPanel />
      </aside>
    </div>
  );
}
