import { useAlertStrip } from "../../api/dashboard/alertStrip";
import { useUrlState } from "../../state/useUrlState";

export const APPROVAL_QUEUE_FLASH_EVENT = "incident-tracker:flash-approval-queue";

// The design drops v2.0's tinted red/amber band entirely: the strip is a neutral row on white and
// severity is carried by a small coloured dot next to each count. Same shell for every state —
// AS-4/§11.13, the strip is never blank and never absent, only re-populated.
const STRIP_CLASS =
  "mx-auto flex w-full max-w-[1360px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 text-[14px]";
const ITEM_CLASS =
  "inline-flex items-center gap-2 rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-black/[0.04]";

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`size-[7px] shrink-0 rounded-full ${className}`} />;
}

// AS-1..AS-8: mounted in the header, outside every TabPanel, so it is unaffected by which tab is
// visible and its 30s poll (useAlertStrip) never pauses (FR-015, research.md §12).
export function AlertStrip() {
  const { data, isError, error } = useAlertStrip();
  const { setTab, setFilter } = useUrlState();

  if (isError) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-severity="error"
        className="border-b border-border bg-card"
      >
        <div className={STRIP_CLASS}>
          <Dot className="bg-bad" />
          <span className="text-bad">
            {(error as Error | undefined)?.message ?? "Could not load the alert strip."}
          </span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-severity="loading"
        className="border-b border-border bg-card"
      >
        <div className={STRIP_CLASS}>
          <Dot className="bg-border" />
          <span className="text-subtle-foreground">Loading alert strip…</span>
        </div>
      </div>
    );
  }

  const severity = data.p1Active > 0 ? "hot" : data.awaitingApproval > 0 ? "warm" : "calm";

  if (severity === "calm") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-severity="calm"
        className="border-b border-border bg-card"
      >
        <div className={STRIP_CLASS}>
          <Dot className="bg-ok" />
          <span>No critical incidents · no approvals pending</span>
          <span className="meta ml-auto">
            Automation handled {data.autoExecutedCountInRange} actions in the last 7 days
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-severity={severity}
      className="border-b border-border bg-card data-[severity=hot]:border-bad/25 data-[severity=hot]:bg-chip-bad-bg data-[severity=warm]:border-warn/25 data-[severity=warm]:bg-chip-warn-bg"
    >
      <div className={STRIP_CLASS}>
        {data.p1Active > 0 && (
          <button
            className={ITEM_CLASS}
            onClick={() => {
              setTab("now");
              setFilter({ kind: "kpiTile", key: "p1Active", label: "P1 active" });
            }}
          >
            <span className="relative flex size-[7px] shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-p1 opacity-75" />
              <Dot className="relative bg-p1" />
            </span>
            <b className="font-semibold text-p1">{data.p1Active}</b> P1 active
          </button>
        )}
        {data.awaitingApproval > 0 && (
          <button
            className={ITEM_CLASS}
            onClick={() => {
              setTab("now");
              window.dispatchEvent(new CustomEvent(APPROVAL_QUEUE_FLASH_EVENT));
            }}
          >
            <Dot className="bg-p2" />
            <b className="font-semibold text-p2">{data.awaitingApproval}</b> awaiting approval
          </button>
        )}
        <span className="meta ml-auto">
          {data.oldestPendingAgeMinutes != null
            ? `oldest pending ${data.oldestPendingAgeMinutes}m`
            : "nothing blocked on a human"}
        </span>
      </div>
    </div>
  );
}
