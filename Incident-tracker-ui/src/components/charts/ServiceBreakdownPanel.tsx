import { useBreakdowns } from "../../api/dashboard/breakdowns";
import { PanelBoundary } from "../shared/PanelBoundary";
import { Panel } from "../shared/Panel";
import { BreakdownBars } from "./BreakdownBars";

export function ServiceBreakdownPanel() {
  const { data, isLoading, isError, error, refetch } = useBreakdowns();

  return (
    <Panel title="By service" titleInCard>
      <PanelBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={(error as Error | undefined)?.message}
        onRetry={refetch}
        data={data}
        isEmpty={(d) => d.byService.length === 0}
        emptyNoDataMessage="Service breakdown arrives once incidents are worked in the active range."
        skeleton={
          <div className="h-[240px] animate-pulse rounded-lg border border-border bg-muted/40">
            <span className="sr-only">Loading service breakdown…</span>
          </div>
        }
      >
        {(breakdowns) => <BreakdownBars variant="service" rows={breakdowns.byService} />}
      </PanelBoundary>
    </Panel>
  );
}
