import type { Priority } from "../../api/types";

// AR-1/A11Y-1: colour is never the sole carrier of meaning — the text label is the content itself.
// Tinted pill rather than a solid fill, matching the design's chip language (see RiskBadge).
const PILL_CLASS = [
  "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tracking-[0.04em] ring-1 ring-inset",
  "data-[priority=P1]:bg-chip-bad-bg data-[priority=P1]:text-p1 data-[priority=P1]:ring-p1/15",
  "data-[priority=P2]:bg-chip-warn-bg data-[priority=P2]:text-p2 data-[priority=P2]:ring-p2/15",
  "data-[priority=P3]:bg-chip-info-bg data-[priority=P3]:text-p3 data-[priority=P3]:ring-p3/15",
  "data-[priority=P4]:bg-muted data-[priority=P4]:text-p4 data-[priority=P4]:ring-p4/15",
].join(" ");

export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <span data-priority={priority} className={PILL_CLASS}>
      <span aria-hidden="true" className="size-[5px] shrink-0 rounded-full bg-current" />
      {priority}
    </span>
  );
}
