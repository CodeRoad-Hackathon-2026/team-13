import type { ExecutedActionStatus } from "../../api/types";

// EO-1: ROLLED_BACK is its own bucket, distinct from FAILED, textually and visually — its own
// hue (--roll), never a shade of the failure red.
//
// A lookup map rather than `data-[status=...]` variants: Tailwind reads `_` inside an arbitrary
// variant as a space, so `data-[status=ROLLED_BACK]` compiles to a selector that never matches,
// and escaping it breaks differently because the scanner sees the raw source, not the runtime
// string. Literal class strings in a map are scanned correctly and can't drift.
const BASE =
  "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] ring-1 ring-inset";

const BY_STATUS: Record<ExecutedActionStatus, string> = {
  // --run, not --p3: the donut paints RUNNING cyan now, and a badge that disagrees with the chart
  // it labels is worse than either colour on its own.
  RUNNING: "bg-[#e0f4f8] text-run ring-run/15",
  SUCCESS: "bg-chip-ok-bg text-ok ring-ok/15",
  FAILED: "bg-chip-bad-bg text-bad ring-bad/15",
  ROLLED_BACK: "bg-[#efe7fc] text-roll ring-roll/15",
};

export function OutcomeBadge({ status }: { status: ExecutedActionStatus }) {
  return (
    <span data-status={status} className={`${BASE} ${BY_STATUS[status]}`}>
      <span
        aria-hidden="true"
        className="size-[5px] shrink-0 rounded-full bg-current data-[status=RUNNING]:animate-pulse"
        data-status={status}
      />
      {status.replace("_", " ")}
    </span>
  );
}
