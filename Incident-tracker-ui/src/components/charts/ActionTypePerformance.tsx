import type { PerformanceOutcomes } from "../../api/dashboard/performance";
import { formatAge } from "../../domain/age";
import { AccessibleChartTable } from "../shared/AccessibleChartTable";
import { CardHeader } from "../shared/CardHeader";
import { SECTION } from "../shared/sectionStyles";

interface ActionTypePerformanceProps {
  byActionType: PerformanceOutcomes["byActionType"];
}

interface Row {
  actionType: string;
  runs: number;
  successPercent: number | null;
  medianDurationMinutes: number | null;
}

function toRows(byActionType: PerformanceOutcomes["byActionType"]): Row[] {
  return byActionType
    .map((entry) => {
      const runs = entry.success + entry.failed + entry.rolledBack + entry.running;
      // Over settled runs, not all runs: counting an in-flight execution as "not yet a success"
      // makes a type look worse the busier it is, and recovers on its own once things land —
      // a metric that moves without anything changing.
      const settled = entry.success + entry.failed + entry.rolledBack;
      return {
        actionType: entry.actionType,
        runs,
        successPercent: settled > 0 ? Math.round((entry.success / settled) * 100) : null,
        medianDurationMinutes: entry.medianDurationMinutes,
      };
    })
    // Busiest first: the type that runs most is the one whose success rate matters most, and
    // alphabetical order buries it.
    .sort((a, b) => b.runs - a.runs);
}

// The remediation catalogue's own scorecard. The three tiles above answer "how are we doing"; this
// answers "which of these actually works", which is the question that changes what gets automated
// next.
//
// Grouped by action type, not by runbook: recommended_actions has an action_type and a free-text
// description, so a runbook-level rollup would mean inventing a grouping key the schema does not
// carry. Action type is the real grouping this data supports.
export function ActionTypePerformance({ byActionType }: ActionTypePerformanceProps) {
  const rows = toRows(byActionType);

  return (
    <section aria-label="Performance by action type" className={`${SECTION} shadow-xs`}>
      <CardHeader title="By action type" meta={`${rows.length} in range`} />

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No remediation has run in this range yet.
        </p>
      ) : (
        // Explicit widths: left to itself the browser gave the name column everything and
        // collapsed Runs into Success, so the two headers ran together as one word. table-fixed
        // makes the layout a decision rather than a measurement of the content.
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-20" />
            <col className="w-44" />
            <col className="w-36" />
          </colgroup>
          <thead>
            <tr>
              <th className="eyebrow pb-2 text-left font-semibold">Action type</th>
              <th className="eyebrow pb-2 pr-6 text-right font-semibold">Runs</th>
              <th className="eyebrow pb-2 text-left font-semibold">Success</th>
              <th className="eyebrow pb-2 text-right font-semibold">Median duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.actionType} className="border-t border-border-soft">
                <td className="truncate py-2.5 text-[13.5px] text-foreground">{row.actionType}</td>
                <td className="meta py-2.5 pr-6 text-right tabular-nums text-foreground">
                  {row.runs}
                </td>
                <td className="py-2.5">
                  {row.successPercent === null ? (
                    <span className="meta text-subtle-foreground">still running</span>
                  ) : (
                    <span className="flex items-center gap-2.5">
                      {/* A fixed-width meter, not one scaled to the column: these are percentages
                          of different denominators, and stretching each to its own row's max
                          would make 100%-of-2 look like 100%-of-61. */}
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-border-soft"
                      >
                        <span
                          style={{ width: `${row.successPercent}%` }}
                          className="block h-full rounded-full bg-ok"
                        />
                      </span>
                      <span className="meta tabular-nums text-foreground">
                        {row.successPercent}%
                      </span>
                    </span>
                  )}
                </td>
                <td className="meta py-2.5 text-right tabular-nums text-foreground">
                  {row.medianDurationMinutes !== null
                    ? formatAge(row.medianDurationMinutes)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AccessibleChartTable
        caption="Performance by action type"
        columns={[
          { key: "actionType", label: "Action type" },
          { key: "runs", label: "Runs" },
          { key: "success", label: "Success rate" },
          { key: "median", label: "Median duration" },
        ]}
        rows={rows.map((row) => ({
          actionType: row.actionType,
          runs: row.runs,
          success: row.successPercent !== null ? `${row.successPercent}%` : "Still running",
          median:
            row.medianDurationMinutes !== null
              ? formatAge(row.medianDurationMinutes)
              : "Not yet available",
        }))}
      />
    </section>
  );
}
