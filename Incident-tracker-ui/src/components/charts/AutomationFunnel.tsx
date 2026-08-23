import type { FunnelStage } from "../../domain/funnel";
import { shareOfFirstStage, largestDrop, dropSetFor } from "../../domain/funnel";
import { useCrossTabJump } from "../../state/useCrossTabJump";
import { AccessibleChartTable } from "../shared/AccessibleChartTable";
import { CardHeader } from "../shared/CardHeader";
import { BAR_FILL, BAR_TRACK, SECTION } from "../shared/sectionStyles";

interface AutomationFunnelProps {
  stages: FunnelStage[];
  automationRate: { fullyAutomatedPercent: number; humanAssistedPercent: number };
  rangeLabel?: string;
}

// FR-083-089/§6.1/P2: hand-rolled — each row is a click target bound to a domain-computed
// drop-set, not a generic charting-library funnel (research.md §4).
export function AutomationFunnel({
  stages,
  automationRate,
  rangeLabel,
}: AutomationFunnelProps) {
  const jump = useCrossTabJump();
  const drop = largestDrop(stages);
  const received = stages[0]?.count ?? null;
  // Which row carries the largest drop, so that one number is the only coloured thing in a column
  // of greys. Every stage loses something; the panel exists to say which loss to go fix.
  const worstDropLabel = drop?.toLabel ?? null;

  function handleStageClick(index: number) {
    const selection = dropSetFor(stages, index);
    if (selection.unavailable) return;
    jump({
      kind: selection.kind,
      key: selection.key,
      label: selection.label,
      toastMessage: `Jumped to Now — ${selection.label.toLowerCase()}.`,
    });
  }

  return (
    <section aria-label="Automation funnel" className={`${SECTION} shadow-xs`}>
      <CardHeader
        title="Automation funnel"
        meta={
          received !== null
            ? `${received} incidents${rangeLabel ? ` · ${rangeLabel}` : ""}`
            : rangeLabel
        }
      />

      <ol>
        {stages.map((stage, index) => {
          const selection = dropSetFor(stages, index);
          // Length is the share of the first stage, so the shape narrows the way the funnel
          // actually does. Share and conversion are different numbers; this is the one that can
          // be a length.
          const share = shareOfFirstStage(stages, index);
          const isWorstDrop = stage.label === worstDropLabel;

          return (
            <li key={stage.key} className="border-t border-border-soft first:border-t-0">
              <button
                type="button"
                disabled={selection.unavailable}
                onClick={() => handleStageClick(index)}
                className="-mx-2 grid w-full grid-cols-[minmax(0,1fr)_auto_3.5rem_2.5rem] items-baseline gap-x-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="text-[13.5px] text-foreground">{stage.label}</span>
                {stage.count !== null ? (
                  <span className="meta text-[15px] tabular-nums text-foreground">
                    {stage.count}
                  </span>
                ) : (
                  // Assumption 5: never a dash and never a zero. A stage with no measurement yet
                  // and a stage that measured zero are different findings, and both a dash and a
                  // 0 collapse them into one.
                  <span className="meta col-span-3 text-right text-subtle-foreground">
                    Not yet available
                  </span>
                )}
                <span className="meta text-right tabular-nums text-subtle-foreground">
                  {share !== null ? `${share}%` : ""}
                </span>
                {/* ±0 rather than a blank: a stage that lost nothing is a finding, and an empty
                    cell reads as missing data instead. */}
                <span
                  className={`meta text-right tabular-nums ${
                    isWorstDrop ? "font-semibold text-warn" : "text-subtle-foreground"
                  }`}
                >
                  {index === 0 || stage.dropCount === null
                    ? ""
                    : stage.dropCount === 0
                      ? "±0"
                      : `−${stage.dropCount}`}
                </span>

                {share !== null && (
                  <span className={`col-span-4 mt-2 ${BAR_TRACK}`}>
                    <span style={{ width: `${share}%` }} className={BAR_FILL} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {/* The conclusion, in prose, under the chart that supports it. A reader who takes one thing
          from this card should take this — so it is a sentence, not a number to interpret. */}
      {drop && (
        <p className="mt-4 flex gap-2 border-t border-border-soft pt-3 text-[13px] text-muted-foreground">
          <span aria-hidden="true" className="font-semibold text-warn">
            !
          </span>
          <span>
            Largest drop is{" "}
            <b className="font-semibold text-foreground">
              {drop.fromLabel} → {drop.toLabel}
            </b>{" "}
            (−{drop.magnitude}). The Knowledge tab lists the gaps.
          </span>
        </p>
      )}

      <p className="mt-2 text-[13px] text-muted-foreground">
        Fully automated{" "}
        <b className="font-semibold text-foreground">{automationRate.fullyAutomatedPercent}%</b> ·
        human-assisted{" "}
        <b className="font-semibold text-foreground">{automationRate.humanAssistedPercent}%</b>
      </p>

      <AccessibleChartTable
        caption="Automation funnel stage counts"
        columns={[
          { key: "label", label: "Stage" },
          { key: "count", label: "Count" },
          { key: "share", label: "Share of received" },
          { key: "dropCount", label: "Drop count" },
        ]}
        rows={stages.map((stage, index) => ({
          label: stage.label,
          count: stage.count ?? "Not yet available",
          share: (() => {
            const share = shareOfFirstStage(stages, index);
            return share !== null ? `${share}%` : "Not yet available";
          })(),
          dropCount: stage.dropCount ?? "Not yet available",
        }))}
      />
    </section>
  );
}
