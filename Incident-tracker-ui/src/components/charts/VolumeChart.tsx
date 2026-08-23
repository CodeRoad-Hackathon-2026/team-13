import {
  BarChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { XAxisTickContentProps } from "recharts/types/util/types";
import type { VolumeBucket } from "../../api/dashboard/breakdowns";
import type { TimeRange } from "../../domain/filters";
import { bucketGranularityFor, formatBucketLabel } from "../../domain/volumeBuckets";
import { formatAge } from "../../domain/age";
import { AccessibleChartTable } from "../shared/AccessibleChartTable";
import { CardHeader } from "../shared/CardHeader";
import { SECTION } from "../shared/sectionStyles";

interface VolumeChartProps {
  buckets: VolumeBucket[];
  timeRange: TimeRange;
}

// Both plots read from the same tokens as the rest of the page, so the charts sit inside the
// design rather than beside it. Grid and axes are solid hairlines: dashing adds noise and reads
// as "threshold" or "projection" when it is only a grid.
const AXIS_TICK = { fill: "var(--subtle-foreground)", fontSize: 11 };
const GRID_STROKE = "var(--border-soft)";
// Both charts reserve the same gutter for their y-axis so the two x-scales line up, even though
// one counts incidents and the other counts minutes.
const Y_AXIS_WIDTH = 44;
const X_MARGIN = { top: 4, right: 8, bottom: 0, left: 0 };

const TOOLTIP_PROPS = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "var(--shadow-md)",
    fontSize: 12,
  },
  labelStyle: { color: "var(--foreground)", fontWeight: 600, marginBottom: 2 },
  itemStyle: { padding: 0 },
} as const;

// A legend in the card header rather than floating under the plot, so the card states what it
// contains before the reader reaches the marks. Text wears a text token, never the series colour:
// the swatch already carries identity, and coloured body text reads as a link.
function LegendKey({ label, swatch }: { label: string; swatch: "known" | "unknown" | "line" }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      {swatch === "line" ? (
        <span aria-hidden="true" className="h-0.5 w-3.5 rounded-full bg-p3" />
      ) : (
        <span
          aria-hidden="true"
          className={`size-2.5 rounded-[3px] ${swatch === "known" ? "bg-chart-1" : "bg-chart-2"}`}
        />
      )}
      {label}
    </span>
  );
}

// FR-095/FR-096/P4: known/unknown volume over time, and median resolution time under it.
//
// These were one plot with two y-scales — counts on the left, minutes on the right. The alignment
// between two such scales is arbitrary, so the chart invented a relationship that is not in the
// data: with one bucket at ~1600 minutes the line collapsed onto the floor and stayed there,
// saying nothing about any other day. Two plots, one scale each, sharing the x-axis: the same
// comparison is still available to the eye, and neither series distorts the other.
//
// One card, one header, one legend, one caption — the pairing is the point, so it must not read as
// two charts that happen to be adjacent.
export function VolumeChart({ buckets, timeRange }: VolumeChartProps) {
  const granularity = bucketGranularityFor(timeRange);
  const rows = buckets.map((bucket) => ({
    ...bucket,
    label: formatBucketLabel(bucket.bucketStart, granularity),
    total: bucket.known + bucket.unknown,
  }));
  const resolved = rows.filter((row) => row.medianResolutionMinutes !== null);
  const hasResolutionData = resolved.length > 0;
  const rangeLabel =
    rows.length > 0 ? `${rows[0].label} – ${rows[rows.length - 1].label}` : undefined;

  // The sentence under the chart, and only when there is a real change to report: a caption that
  // always appears is decoration, and a reader learns to skip it.
  const first = resolved[0]?.medianResolutionMinutes ?? null;
  const last = resolved[resolved.length - 1]?.medianResolutionMinutes ?? null;
  const trend =
    first !== null && last !== null && resolved.length > 1 && first !== last
      ? { direction: last < first ? "fell" : "rose", from: formatAge(first), to: formatAge(last) }
      : null;

  // Count above date. The count is what the bar already encodes, so putting it on the axis lets a
  // reader take the number without hunting for a tooltip.
  function renderTick({ x, y, payload }: XAxisTickContentProps) {
    const label = String(payload?.value ?? "");
    const row = rows.find((candidate) => candidate.label === label);
    return (
      <g transform={`translate(${x},${y})`}>
        <text y={14} textAnchor="middle" fill="var(--muted-foreground)" fontSize={12}>
          {row ? row.total : ""}
        </text>
        <text y={30} textAnchor="middle" fill="var(--subtle-foreground)" fontSize={11}>
          {label}
        </text>
      </g>
    );
  }

  return (
    <section aria-label="Incident volume" className={`${SECTION} shadow-xs`}>
      <CardHeader title="Incident volume & time to resolve">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LegendKey label="Known" swatch="known" />
          <LegendKey label="Unknown" swatch="unknown" />
          {hasResolutionData && <LegendKey label="MTTR" swatch="line" />}
        </div>
      </CardHeader>

      <ResponsiveContainer width="100%" height={236}>
        <BarChart data={rows} margin={X_MARGIN}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={renderTick}
            height={40}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            width={Y_AXIS_WIDTH}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip cursor={{ fill: "var(--muted)" }} {...TOOLTIP_PROPS} />
          {/* Identity, not judgement: "unknown" means not classified yet, so these are chart
              series rather than --ok/--bad. The surface-coloured stroke is what puts a 2px gap
              between the two stacked fills instead of a border around them. maxBarSize keeps a
              seven-bucket range from rendering as saturated slabs the width of the card.

              Animation is off because these panels poll: TanStack Query hands Recharts new data
              every refetch, and each one replays the grow-from-baseline transition. On a dashboard
              left open that is a chart redrawing itself for no reason. */}
          <Bar
            dataKey="known"
            stackId="volume"
            name="Known"
            fill="var(--chart-1)"
            stroke="var(--card)"
            strokeWidth={1.5}
            maxBarSize={34}
            isAnimationActive={false}
          />
          <Bar
            dataKey="unknown"
            stackId="volume"
            name="Unknown"
            fill="var(--chart-2)"
            stroke="var(--card)"
            strokeWidth={1.5}
            maxBarSize={34}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>

      {hasResolutionData && (
        <div className="mt-2 border-t border-border-soft pt-3">
          <h4 className="eyebrow mb-1">Median time to resolve</h4>
          <ResponsiveContainer width="100%" height={116}>
            <LineChart data={rows} margin={X_MARGIN}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              {/* scale="band" is what keeps this plot's Aug 19 above the bar chart's Aug 19. A
                  LineChart otherwise starts its point scale hard against the axis while bars sit
                  centred in their band, and two x-axes half a band apart defeat the only reason
                  to stack them. (padding="gap" looks like the same fix and does nothing here.) */}
              <XAxis
                dataKey="label"
                scale="band"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                width={Y_AXIS_WIDTH}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                unit="m"
              />
              <Tooltip
                formatter={(value) => [formatAge(Number(value)), "Median resolve"]}
                {...TOOLTIP_PROPS}
              />
              <Line
                dataKey="medianResolutionMinutes"
                name="Median resolve"
                stroke="var(--p3)"
                strokeWidth={2}
                connectNulls
                dot={{ r: 4, fill: "var(--card)", stroke: "var(--p3)", strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border-soft pt-3">
        <p className="text-[13px] text-muted-foreground">
          {trend ? (
            <>
              Median time to resolve {trend.direction} from{" "}
              <b className="font-semibold text-foreground">{trend.from}</b> to{" "}
              <b className="font-semibold text-foreground">{trend.to}</b> across this range.
            </>
          ) : hasResolutionData ? (
            "Median time to resolve held steady across this range."
          ) : (
            "Nothing has been resolved in this range yet, so there is no median to trend."
          )}
        </p>
        {rangeLabel && <span className="meta shrink-0">{rangeLabel}</span>}
      </div>

      <AccessibleChartTable
        caption="Incident volume by bucket"
        columns={[
          { key: "label", label: granularity === "hour" ? "Hour" : "Day" },
          { key: "known", label: "Known" },
          { key: "unknown", label: "Unknown" },
          { key: "medianResolutionMinutes", label: "Median resolve" },
        ]}
        rows={rows.map((bucket) => ({
          label: bucket.label,
          known: bucket.known,
          unknown: bucket.unknown,
          medianResolutionMinutes:
            bucket.medianResolutionMinutes !== null
              ? formatAge(bucket.medianResolutionMinutes)
              : "Not yet available",
        }))}
      />
    </section>
  );
}
