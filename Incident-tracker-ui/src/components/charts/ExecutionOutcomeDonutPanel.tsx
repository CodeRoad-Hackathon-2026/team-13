import { usePerformance } from "../../api/dashboard/performance";
import { PanelBoundary } from "../shared/PanelBoundary";
import { Panel } from "../shared/Panel";
import { ExecutionOutcomeDonut } from "./ExecutionOutcomeDonut";

// See AutomationFunnelPanel.tsx: shares the same underlying query, owns its own render-error
// isolation.
export function ExecutionOutcomeDonutPanel() {
  const { data, isLoading, isError, error, refetch } = usePerformance();

  return (
    <Panel title="Execution outcomes" titleInCard>
      <PanelBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={(error as Error | undefined)?.message}
        onRetry={refetch}
        data={data}
        isEmpty={() => false}
        emptyNoDataMessage="Execution outcomes arrive once actions have run in the active range."
        skeleton={
          <div className="h-[240px] animate-pulse rounded-lg border border-border bg-muted/40">
            <span className="sr-only">Loading execution outcomes…</span>
          </div>
        }
      >
        {(perf) => <ExecutionOutcomeDonut outcomes={perf.outcomes} />}
      </PanelBoundary>
    </Panel>
  );
}
