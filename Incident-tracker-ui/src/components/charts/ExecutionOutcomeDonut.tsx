import { ArrowUpRight } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { PerformanceOutcomes } from "../../api/dashboard/performance";
import type { ExecutedActionStatus } from "../../api/types";
import { useUrlState } from "../../state/useUrlState";
import { formatAge } from "../../domain/age";
import { AccessibleChartTable } from "../shared/AccessibleChartTable";
import { CardHeader } from "../shared/CardHeader";
import { SECTION } from "../shared/sectionStyles";

interface ExecutionOutcomeDonutProps {
  outcomes: PerformanceOutcomes;
}

// Same hues as OutcomeBadge — the donut and the legend beside it must agree, and ROLLED_BACK in
// particular must stay its own violet, never read as a shade of warning-amber or failure-red
// (EO-1).
//
// The warm gold this palette was drafted with does not survive measurement: against the failure
// red it lands at ΔE 0.2 under deuteranopia — the same colour — and its chroma reads as grey. It
// is the exact collision --run was added to fix, one slot over.
const OUTCOME_COLORS: Record<ExecutedActionStatus, string> = {
  SUCCESS: "var(--ok)",
  FAILED: "var(--bad)",
  ROLLED_BACK: "var(--roll)",
  RUNNING: "var(--run)",
};

const OUTCOME_LABELS: Record<ExecutedActionStatus, string> = {
  SUCCESS: "Success",
  FAILED: "Failed",
  ROLLED_BACK: "Rolled back",
  RUNNING: "Running",
};

// FR-090-094/EO-1..EO-4: distribution over success/failed/rolled-back/running with the success
// rate as the centre label. ROLLED_BACK is always its own bucket — never merged into failed.
export function ExecutionOutcomeDonut({ outcomes }: ExecutionOutcomeDonutProps) {
  const { setIncident } = useUrlState();

  const rows: Array<{ status: ExecutedActionStatus; value: number }> = [
    { status: "SUCCESS", value: outcomes.counts.success },
    { status: "FAILED", value: outcomes.counts.failed },
    { status: "ROLLED_BACK", value: outcomes.counts.rolledBack },
    { status: "RUNNING", value: outcomes.counts.running },
  ];
  const totalRuns = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <section aria-label="Execution outcomes" className={`${SECTION} shadow-xs`}>
      <CardHeader
        title="Execution outcomes"
        meta={`${totalRuns} ${totalRuns === 1 ? "run" : "runs"}`}
      />

      <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
        {/* The success rate belongs in the hole. Beside the donut it left the centre empty and a
            wide dead strip to its right, so the one number the chart exists to deliver read as a
            caption. A thin ring both makes room for it and keeps a saturated fill off a large
            block. */}
        <div className="relative size-[172px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="status"
                innerRadius={57}
                outerRadius={78}
                stroke="var(--card)"
                strokeWidth={2}
                paddingAngle={rows.filter((row) => row.value > 0).length > 1 ? 2 : 0}
                // Off, not shortened: the panel polls, so every refetch replayed the sweep-in.
                // Recharts' 1.5s default is also long enough that the ring reads as missing on
                // load, with the centred success rate already painted inside an empty circle.
                isAnimationActive={false}
              >
                {rows.map((row) => (
                  <Cell key={row.status} fill={OUTCOME_COLORS[row.status]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, status) => [
                  value,
                  OUTCOME_LABELS[status as ExecutedActionStatus] ?? String(status),
                ]}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                  boxShadow: "var(--shadow-md)",
                  fontSize: 12,
                }}
                labelStyle={{ display: "none" }}
                itemStyle={{ padding: 0 }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Proportional figures, not tabular-nums: equal-width digits make a display-size
              number look loose. Nothing here is aligned in a column. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[30px] font-semibold leading-none tracking-[-0.9px] text-foreground">
              {outcomes.successRatePercent}%
            </span>
            <span className="eyebrow mt-1.5">Success rate</span>
          </div>
        </div>

        {/* A legend that is also the numbers. Two lists — swatches here, counts elsewhere — makes
            the reader join them by eye; one aligned table does not. */}
        <ul className="min-w-[15rem] flex-1">
          {rows.map((row) => (
            <li
              key={row.status}
              className="grid grid-cols-[auto_minmax(0,1fr)_2.5rem_3rem] items-center gap-x-3 border-t border-border-soft py-2.5 first:border-t-0 first:pt-0"
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: OUTCOME_COLORS[row.status] }}
              />
              <span className="text-[13.5px] text-foreground">{OUTCOME_LABELS[row.status]}</span>
              <span className="meta text-right text-[15px] tabular-nums text-foreground">
                {row.value}
              </span>
              <span className="meta text-right tabular-nums text-subtle-foreground">
                {totalRuns > 0 ? `${Math.round((row.value / totalRuns) * 100)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-border-soft pt-3">
        <span className="text-[13px] text-muted-foreground">Median execution duration</span>
        <span className="meta tabular-nums text-foreground">
          {outcomes.medianDurationMinutes !== null
            ? formatAge(outcomes.medianDurationMinutes)
            : "Not yet available"}
        </span>
      </div>

      <div className="mt-4 border-t border-border-soft pt-3">
        <h4 className="eyebrow mb-1">Recent failures</h4>
        {outcomes.recentFailures.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No recent failures.</p>
        ) : (
          <ul>
            {outcomes.recentFailures.map((failure) => (
              <li
                key={failure.executedActionId}
                className="flex items-center gap-3 border-t border-border-soft py-2.5 text-[13px] first:border-t-0"
              >
                <span className="meta shrink-0 text-[11px] uppercase text-subtle-foreground">
                  {failure.actionType}
                </span>
                {/* EO-2/FR-092 wants the incident named here, not only reachable through the
                    link: a failure you cannot cite is a failure you cannot bring to anyone. */}
                <span className="meta shrink-0 text-subtle-foreground">{failure.incidentId}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {failure.truncatedErrorMessage}
                </span>
                {/* "Open" is the right visible word in a row that already names its subject, and
                    the wrong accessible name — several of them in a list all read "Open". */}
                <button
                  type="button"
                  onClick={() => setIncident(failure.incidentId)}
                  aria-label={`Open incident ${failure.incidentId}`}
                  className="flex shrink-0 items-center gap-0.5 text-[12.5px] font-medium text-p3 transition-colors hover:text-foreground"
                >
                  Open
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AccessibleChartTable
        caption="Execution outcomes"
        columns={[
          { key: "status", label: "Outcome" },
          { key: "value", label: "Count" },
        ]}
        rows={rows.map((row) => ({ status: OUTCOME_LABELS[row.status], value: row.value }))}
      />
    </section>
  );
}
