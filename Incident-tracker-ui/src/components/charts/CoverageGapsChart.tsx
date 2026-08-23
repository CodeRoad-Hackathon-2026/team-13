import type { CoverageGapService } from "../../domain/coverageGaps";
import { sortAscendingByKnownRate, highestLeverageFixCaption } from "../../domain/coverageGaps";
import { AccessibleChartTable } from "../shared/AccessibleChartTable";

interface CoverageGapsChartProps {
  services: CoverageGapService[];
}

type Threshold = "RED" | "AMBER" | "GREEN";

function thresholdFor(knownRate: number): Threshold {
  if (knownRate < 0.6) return "RED";
  if (knownRate < 0.8) return "AMBER";
  return "GREEN";
}

// FR-100/FR-101/K2: hand-rolled horizontal bars, worst-first, red/amber/green thresholds each
// carrying a text label (A11Y-1 — colour is never the only signal), with the highest-leverage fix
// named explicitly rather than left for the reader to infer.
export function CoverageGapsChart({ services }: CoverageGapsChartProps) {
  const sorted = sortAscendingByKnownRate(services);
  const caption = highestLeverageFixCaption(services);

  return (
    <section
      aria-label="Runbook coverage gaps"
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      {caption && <p className="mb-3 text-[13px] text-muted-foreground">{caption}</p>}
      <ol>
        {sorted.map((service) => {
          const percent = Math.round(service.knownRate * 100);
          const threshold = thresholdFor(service.knownRate);
          return (
            <li
              key={service.serviceId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-2"
            >
              <span className="text-[13px]">{service.serviceName}</span>
              <span className="meta tabular-nums text-foreground">
                {percent}%
                {/* A11Y-1: the RED/AMBER/GREEN band is spelled out, never left to the bar colour. */}
                <span
                  data-threshold={threshold}
                  className="ml-2 text-[10.5px] font-semibold tracking-[0.06em] data-[threshold=RED]:text-bad data-[threshold=AMBER]:text-warn data-[threshold=GREEN]:text-ok"
                >
                  {threshold}
                </span>
              </span>
              <div
                role="img"
                aria-label={`${service.serviceName} known-incident rate ${percent}%`}
                className="col-span-2 mt-1 h-2 w-full overflow-hidden rounded-sm bg-muted"
              >
                <div
                  data-threshold={threshold}
                  style={{ width: `${percent}%` }}
                  className="h-full rounded-sm data-[threshold=RED]:bg-bad data-[threshold=AMBER]:bg-warn data-[threshold=GREEN]:bg-ok"
                />
              </div>
            </li>
          );
        })}
      </ol>
      <AccessibleChartTable
        caption="Runbook coverage gaps by service, ascending"
        columns={[
          { key: "serviceName", label: "Service" },
          { key: "knownRatePercent", label: "Known-incident rate" },
        ]}
        rows={sorted.map((s) => ({
          serviceName: s.serviceName,
          knownRatePercent: `${Math.round(s.knownRate * 100)}%`,
        }))}
      />
    </section>
  );
}
