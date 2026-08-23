import { usePerformance } from "../../api/dashboard/performance";
import { PanelBoundary } from "../shared/PanelBoundary";
import { Panel } from "../shared/Panel";
import { ActionTypePerformance } from "./ActionTypePerformance";

// Shares the /api/dashboard/performance query with the tiles, the funnel and the donut — TanStack
// Query dedups the request — while owning its own boundary, so a render failure here never blanks
// the rest of the tab (Principle VIII).
export function ActionTypePerformancePanel() {
  const { data, isLoading, isError, error, refetch } = usePerformance();

  return (
    <Panel title="Performance by action type" titleInCard>
      <PanelBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={(error as Error | undefined)?.message}
        onRetry={refetch}
        data={data}
        isEmpty={() => false}
        emptyNoDataMessage="Action-type performance appears once remediations have run in the active range."
        skeleton={
          <div className="h-[220px] animate-pulse rounded-xl border border-border bg-muted/40">
            <span className="sr-only">Loading action-type performance…</span>
          </div>
        }
      >
        {(perf) => <ActionTypePerformance byActionType={perf.outcomes.byActionType} />}
      </PanelBoundary>
    </Panel>
  );
}
