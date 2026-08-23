import { BookMarked, Timer, Zap } from "lucide-react";
import { usePerformance } from "../../api/dashboard/performance";
import { useCrossTabJump } from "../../state/useCrossTabJump";
import { describePerformanceDelta, formatMedianResolveMinutes } from "../../domain/kpi";
import { formatAge } from "../../domain/age";
import { PanelBoundary } from "../shared/PanelBoundary";
import { KpiTile } from "./KpiTile";
import { KpiRow } from "./KpiRow";

// FR-080-082/N1b: the three Performance-tab automation tiles, one query, every click routed
// through the cross-tab jump (clicking a Performance tile always lands on Now, per FR-082).
export function KpiStripPerformance() {
  const { data, isLoading, isError, error, refetch } = usePerformance();
  const jump = useCrossTabJump();

  return (
    <PanelBoundary
      isLoading={isLoading}
      isError={isError}
      errorMessage={(error as Error | undefined)?.message}
      onRetry={refetch}
      data={data}
      isEmpty={() => false}
      emptyNoDataMessage="Performance data arrives once incidents are worked in the active range."
      skeleton={
        <div className="h-[86px] animate-pulse rounded-lg border border-border bg-muted/50">
          <span className="sr-only">Loading tiles…</span>
        </div>
      }
    >
      {(perf) => (
        <KpiRow>
          <KpiTile
            icon={Zap}
            label="Automation rate"
            value={`${perf.tiles.automationRatePercent.value}%`}
            delta={
              describePerformanceDelta(
                "automationRatePercent",
                perf.tiles.automationRatePercent.deltaVsPrevious,
              ) ?? undefined
            }
            onClick={() =>
              jump({
                kind: "kpiTile",
                key: "automationRate",
                label: "Fully automated",
                toastMessage: "Jumped to Now — incidents resolved without human approval.",
              })
            }
          />
          <KpiTile
            icon={Timer}
            label="Median time to resolve"
            value={formatMedianResolveMinutes(perf.tiles.medianTimeToResolveMinutes.value)}
            title={`Average: ${formatAge(perf.tiles.medianTimeToResolveMinutes.averageMinutes)}`}
            delta={
              describePerformanceDelta(
                "medianTimeToResolveMinutes",
                perf.tiles.medianTimeToResolveMinutes.deltaVsPrevious,
              ) ?? undefined
            }
            onClick={() =>
              jump({
                kind: "kpiTile",
                key: "medianResolve",
                label: "Resolved incidents",
                toastMessage: "Jumped to Now — resolved incidents in this range.",
              })
            }
          />
          <KpiTile
            icon={BookMarked}
            label="Known-incident hit rate"
            value={`${perf.tiles.knownIncidentHitRate.value}%`}
            delta={
              describePerformanceDelta(
                "knownIncidentHitRate",
                perf.tiles.knownIncidentHitRate.deltaVsPrevious,
              ) ?? undefined
            }
            onClick={() =>
              jump({
                kind: "kpiTile",
                key: "knownHitRate",
                label: "Known incidents",
                toastMessage:
                  "Jumped to Now — incidents matched to a known runbook or prior incident.",
              })
            }
          />
        </KpiRow>
      )}
    </PanelBoundary>
  );
}
