import { usePerformance } from "../../api/dashboard/performance";
import { useUrlState } from "../../state/useUrlState";
import { PanelBoundary } from "../shared/PanelBoundary";
import { Panel } from "../shared/Panel";
import { AutomationFunnel } from "./AutomationFunnel";

// Fetches the same shared /api/dashboard/performance query as KpiStripPerformance and
// ExecutionOutcomeDonutPanel (TanStack Query dedups the actual network request, per contracts/
// dashboard-endpoints.md's "one request serves all three") but owns its own PanelBoundary/error
// boundary, so a render failure here never blanks the other two sections (Principle VIII).
export function AutomationFunnelPanel() {
  const { data, isLoading, isError, error, refetch } = usePerformance();
  // The card states its own scope: "16 incidents · 7d" answers "the whole of what?", which is
  // the first question a funnel raises and the one no row can answer.
  const { timeRange } = useUrlState();

  return (
    <Panel title="Automation funnel" titleInCard>
      <PanelBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={(error as Error | undefined)?.message}
        onRetry={refetch}
        data={data}
        isEmpty={() => false}
        emptyNoDataMessage="Funnel data arrives once incidents are worked in the active range."
        skeleton={
          <div className="h-[240px] animate-pulse rounded-lg border border-border bg-muted/40">
            <span className="sr-only">Loading funnel…</span>
          </div>
        }
      >
        {(perf) => (
          <AutomationFunnel
            stages={perf.funnel.stages}
            automationRate={perf.funnel.automationRate}
            rangeLabel={timeRange}
          />
        )}
      </PanelBoundary>
    </Panel>
  );
}
