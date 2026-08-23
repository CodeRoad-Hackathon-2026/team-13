import { AlertTriangle, Clock, Inbox, UserX } from "lucide-react";
import { useNowTiles } from "../../api/dashboard/now";
import { useUrlState } from "../../state/useUrlState";
import { describeDelta } from "../../domain/kpi";
import { formatAge } from "../../domain/age";
import { PanelBoundary } from "../shared/PanelBoundary";
import { KpiTile } from "./KpiTile";
import { KpiRow } from "./KpiRow";

// FR-027-030: the four Now-tab operational tiles — never P1-active or awaiting-approval, which
// live exclusively in the alert strip. Renders before any chart (P-2, satisfied by mounting
// order in App.tsx).
export function KpiStripNow() {
  const { data, isLoading, isError, error, refetch } = useNowTiles();
  const { setFilter, activeFilter } = useUrlState();

  return (
    <PanelBoundary
      isLoading={isLoading}
      isError={isError}
      errorMessage={(error as Error | undefined)?.message}
      onRetry={refetch}
      data={data}
      isEmpty={() => false}
      emptyNoDataMessage="Incidents arrive from email, PagerDuty, Slack, and the API."
      skeleton={
        <div className="h-[86px] animate-pulse rounded-lg border border-border bg-muted/50">
          <span className="sr-only">Loading tiles…</span>
        </div>
      }
    >
      {(tiles) => (
        <KpiRow>
          <KpiTile
            icon={Inbox}
            label="Open incidents"
            value={tiles.openIncidents.value}
            delta={describeDelta("openIncidents", tiles.openIncidents.deltaVsPrevious)}
            onClick={() =>
              setFilter({ kind: "kpiTile", key: "openIncidents", label: "Open incidents" })
            }
            isActive={activeFilter?.key === "openIncidents"}
          />
          <KpiTile
            icon={AlertTriangle}
            label="Escalated"
            value={tiles.escalated.value}
            severity={tiles.escalated.value > 0 ? "urgent" : "none"}
            delta={describeDelta("escalated", tiles.escalated.deltaVsPrevious)}
            onClick={() => setFilter({ kind: "kpiTile", key: "escalated", label: "Escalated" })}
            isActive={activeFilter?.key === "escalated"}
          />
          <KpiTile
            icon={UserX}
            label="Unassigned"
            value={tiles.unassigned.value}
            severity={tiles.unassigned.value > 0 ? "cautionary" : "none"}
            delta={describeDelta("unassigned", tiles.unassigned.deltaVsPrevious)}
            onClick={() => setFilter({ kind: "kpiTile", key: "unassigned", label: "Unassigned" })}
            isActive={activeFilter?.key === "unassigned"}
          />
          <KpiTile
            icon={Clock}
            label="Oldest open"
            value={
              tiles.oldestOpen.ageMinutes != null ? formatAge(tiles.oldestOpen.ageMinutes) : "—"
            }
            sub={tiles.oldestOpen.priority ?? undefined}
            onClick={() => setFilter({ kind: "kpiTile", key: "oldestOpen", label: "Oldest open" })}
            isActive={activeFilter?.key === "oldestOpen"}
          />
        </KpiRow>
      )}
    </PanelBoundary>
  );
}
