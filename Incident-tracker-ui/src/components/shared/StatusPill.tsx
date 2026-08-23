import type { IncidentStatus } from "../../api/types";

// N3/A11Y-1: ESCALATED distinct from OPEN via data-status, not colour alone. Covers the full
// v2.0 status enum, including INVESTIGATING/MITIGATED observed in the v2 prototype.
// Neutral by default — only the statuses that demand attention take a tint.
const PILL_CLASS = [
  "inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground ring-1 ring-inset ring-border",
  "data-[status=ESCALATED]:bg-chip-bad-bg data-[status=ESCALATED]:text-bad data-[status=ESCALATED]:ring-bad/15",
  "data-[status=OPEN]:bg-chip-info-bg data-[status=OPEN]:text-p3 data-[status=OPEN]:ring-p3/15",
  "data-[status=INVESTIGATING]:bg-chip-warn-bg data-[status=INVESTIGATING]:text-warn data-[status=INVESTIGATING]:ring-warn/15",
  "data-[status=MITIGATED]:bg-chip-ok-bg data-[status=MITIGATED]:text-ok data-[status=MITIGATED]:ring-ok/15",
  "data-[status=RESOLVED]:bg-chip-ok-bg data-[status=RESOLVED]:text-ok data-[status=RESOLVED]:ring-ok/15",
].join(" ");

export function StatusPill({ status }: { status: IncidentStatus }) {
  return (
    <span data-status={status} className={PILL_CLASS}>
      <span aria-hidden="true" className="size-[5px] shrink-0 rounded-full bg-current" />
      {status}
    </span>
  );
}
