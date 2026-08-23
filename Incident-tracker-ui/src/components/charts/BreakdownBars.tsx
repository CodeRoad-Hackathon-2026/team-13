import type { Priority } from "../../api/types";
import { useCrossTabJump } from "../../state/useCrossTabJump";
import { PriorityPill } from "../shared/PriorityPill";
import { AccessibleChartTable } from "../shared/AccessibleChartTable";
import { CardHeader } from "../shared/CardHeader";
import { BAR_FILL, BAR_FILL_MUTED, BAR_TRACK, SECTION } from "../shared/sectionStyles";

type BreakdownVariant = "priority" | "category" | "service";

interface BreakdownBarsProps {
  variant: "priority";
  rows: Array<{ priority: Priority; count: number }>;
}

interface CategoryBreakdownBarsProps {
  variant: "category";
  rows: Array<{ category: string; count: number }>;
}

interface ServiceBreakdownBarsProps {
  variant: "service";
  rows: Array<{ serviceId: string; serviceName: string; count: number; knownRate: number }>;
}

type Props = BreakdownBarsProps | CategoryBreakdownBarsProps | ServiceBreakdownBarsProps;

interface NormalizedRow {
  id: string;
  label: string;
  count: number;
  breakdownKey: string;
  knownRatePercent?: number;
}

// Priority is an ordered category with colours the rest of the app already teaches, so its bars
// carry them: the bar then reinforces the pill on its own row instead of contradicting it.
//
// Category and service are nominal — no inherent order — so they get one colour for every bar.
// Shading those by size would double-encode the length as hue and spend the only free channel on
// something the bar already says.
const PRIORITY_BAR: Record<Priority, string> = {
  P1: "bg-p1",
  P2: "bg-p2",
  P3: "bg-p3",
  P4: "bg-p4",
};

// The card's scope note. Each breakdown is a different kind of partial view and the reader has
// no way to tell which from the bars: priority partitions everything, category is a truncated
// head, service carries a second measure. Saying so is one line of type.
const VARIANT_TITLE: Record<BreakdownVariant, string> = {
  priority: "By priority",
  category: "By category",
  service: "By service",
};

// Rows that stand for an absence rather than a thing — they get the muted bar, because
// "Uncategorised" is the gap the Knowledge tab exists to close, not a category anyone chose.
const ABSENCE_LABELS = new Set(["Uncategorised", "Uncategorized", "Unknown", "Other"]);

const VARIANT_LABEL: Record<BreakdownVariant, string> = {
  priority: "Breakdown by priority",
  category: "Breakdown by category",
  service: "Breakdown by service",
};

function normalize(props: Props): NormalizedRow[] {
  switch (props.variant) {
    case "priority":
      return props.rows.map((row) => ({
        id: row.priority,
        label: row.priority,
        count: row.count,
        breakdownKey: `priority:${row.priority}`,
      }));
    case "category":
      return props.rows.map((row) => ({
        id: row.category,
        label: row.category,
        count: row.count,
        breakdownKey: `category:${row.category}`,
      }));
    case "service":
      return props.rows.map((row) => ({
        id: row.serviceId,
        label: row.serviceName,
        count: row.count,
        breakdownKey: `service:${row.serviceId}`,
        knownRatePercent: Math.round(row.knownRate * 100),
      }));
  }
}

// FR-097/FR-098/P5: one hand-rolled bars component parameterized for all three breakdowns —
// ordering and top-N+Other selection are the server's job (contracts/dashboard-endpoints.md);
// every segment routes through the same useCrossTabJump call site a funnel stage uses, so a
// breakdown click behaves identically (switch to Now, apply filter, flash, chip, toast).
export function BreakdownBars(props: Props) {
  const jump = useCrossTabJump();
  const rows = normalize(props);
  const maxCount = Math.max(1, ...rows.map((row) => row.count));

  function handleClick(row: NormalizedRow) {
    jump({
      kind: "breakdown",
      key: row.breakdownKey,
      label: `${VARIANT_LABEL[props.variant]}: ${row.label}`,
      toastMessage: `Jumped to Now — ${row.label}.`,
    });
  }

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const meta =
    props.variant === "priority"
      ? `${total} total`
      : props.variant === "category"
        ? `top ${rows.length}`
        : "% known";

  return (
    <section
      aria-label={VARIANT_LABEL[props.variant]}
      className={`${SECTION} shadow-xs`}
    >
      <CardHeader title={VARIANT_TITLE[props.variant]} meta={meta} />
      <ol>
        {rows.map((row) => (
          <li key={row.id} className="border-t border-border-soft first:border-t-0">
            <button
              type="button"
              onClick={() => handleClick(row)}
              className="-mx-2 grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="truncate text-[13.5px] text-foreground">
                {props.variant === "priority" ? (
                  <PriorityPill priority={row.label as Priority} />
                ) : (
                  row.label
                )}
              </span>
              <span className="meta text-[15px] tabular-nums text-foreground">{row.count}</span>
              {/* Priority reads as a share of the whole, because priority partitions every
                  incident. Service reads as % known, its own second measure. Category gets the
                  share too — a truncated head still divides the same total. */}
              <span className="meta text-right tabular-nums text-subtle-foreground">
                {row.knownRatePercent !== undefined
                  ? `${row.knownRatePercent}% known`
                  : total > 0
                    ? `${Math.round((row.count / total) * 100)}%`
                    : ""}
              </span>
              <div
                role="img"
                aria-label={`${row.label} count ${row.count}`}
                className={`col-span-3 mt-2 ${BAR_TRACK}`}
              >
                <div
                  style={{ width: `${(row.count / maxCount) * 100}%` }}
                  className={
                    props.variant === "priority"
                      ? `h-full rounded-full ${PRIORITY_BAR[row.label as Priority]}`
                      : ABSENCE_LABELS.has(row.label)
                        ? BAR_FILL_MUTED
                        : BAR_FILL
                  }
                />
              </div>
            </button>
          </li>
        ))}
      </ol>
      <AccessibleChartTable
        caption={VARIANT_LABEL[props.variant]}
        columns={[
          { key: "label", label: "Segment" },
          { key: "count", label: "Count" },
          { key: "knownRatePercent", label: "Known rate" },
        ]}
        rows={rows.map((row) => ({
          label: row.label,
          count: row.count,
          knownRatePercent: row.knownRatePercent !== undefined ? `${row.knownRatePercent}%` : "—",
        }))}
      />
    </section>
  );
}
