import type { RiskLevel } from "../../api/types";

// AR-1: risk badge is unmissable and always carries a text label, not colour alone.
// The design confines risk colour to this chip and the confidence meter — nothing else on the
// card is tinted, so the chip has to carry the weight on its own. Pill-shaped with a leading dot
// (both `bg-current`, so they pick up whichever hue the data-risk variant below sets) rather than
// a flat rectangle, for a touch more affordance without adding a second colour.
const BADGE_CLASS = [
  "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] ring-1 ring-inset",
  "data-[risk=LOW]:bg-chip-ok-bg data-[risk=LOW]:text-ok data-[risk=LOW]:ring-ok/15",
  "data-[risk=MEDIUM]:bg-chip-warn-bg data-[risk=MEDIUM]:text-warn data-[risk=MEDIUM]:ring-warn/15",
  "data-[risk=HIGH]:bg-chip-bad-bg data-[risk=HIGH]:text-bad data-[risk=HIGH]:ring-bad/15",
].join(" ");

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span data-risk={risk} className={BADGE_CLASS}>
      <span aria-hidden="true" className="size-[5px] shrink-0 rounded-full bg-current" />
      {risk} RISK
    </span>
  );
}
