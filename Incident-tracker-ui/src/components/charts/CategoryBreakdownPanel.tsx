import { useBreakdowns } from "../../api/dashboard/breakdowns";
import { PanelBoundary } from "../shared/PanelBoundary";
import { Panel } from "../shared/Panel";
import { BreakdownBars } from "./BreakdownBars";

export function CategoryBreakdownPanel() {
  const { data, isLoading, isError, error, refetch } = useBreakdowns();

  return (
    <Panel title="By category" titleInCard>
      <PanelBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={(error as Error | undefined)?.message}
        onRetry={refetch}
        data={data}
        isEmpty={(d) => d.byCategory.length === 0}
        emptyNoDataMessage="Category breakdown arrives once incidents are worked in the active range."
        skeleton={
          <div className="h-[240px] animate-pulse rounded-lg border border-border bg-muted/40">
            <span className="sr-only">Loading category breakdown…</span>
          </div>
        }
      >
        {(breakdowns) => <BreakdownBars variant="category" rows={breakdowns.byCategory} />}
      </PanelBoundary>
    </Panel>
  );
}
