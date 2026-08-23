import type { ComponentType, ReactNode } from "react";

export interface KpiTileDelta {
  label: string;
  isGood: boolean;
}

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: KpiTileDelta;
  severity?: "urgent" | "cautionary" | "none";
  onClick?: () => void;
  isActive?: boolean;
  // FR-081: the average MAY be exposed in the tile's tooltip, labelled as the average — the
  // headline value itself stays the median.
  title?: string;
  // Purely decorative — reinforces what the tile counts at a glance. Never the only carrier of
  // meaning (the eyebrow label and value still say it in words either way).
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

// An independent card rather than a cell in a shared strip (see KpiRow) — each tile owns its own
// border, radius and hover elevation. Severity reads through the value's colour and the label
// text rather than a decorative top-edge accent, so colour stays concentrated in the number that
// is actually the data, not doubled onto the card frame around it.
const TILE_CLASS = [
  "group relative w-full overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 text-left shadow-xs",
  "transition-all hover:-translate-y-px hover:border-border hover:shadow-md",
  "data-[active=true]:border-transparent data-[active=true]:bg-selected-bg data-[active=true]:shadow-sm data-[active=true]:ring-2 data-[active=true]:ring-selected-ring/50",
].join(" ");

const VALUE_CLASS = [
  "text-[28px] font-semibold leading-none tracking-[-0.5px] tabular-nums text-foreground",
  "group-data-[severity=urgent]:text-bad group-data-[severity=cautionary]:text-warn",
].join(" ");

// A plain icon beside the eyebrow label, not a tinted box around it — one recognition cue is
// enough; a circle-in-a-card around every metric icon was the redundant part.
const ICON_CLASS = [
  "size-3.5 shrink-0 text-subtle-foreground transition-colors",
  "group-data-[severity=urgent]:text-bad group-data-[severity=cautionary]:text-warn",
  "group-data-[active=true]:text-primary",
].join(" ");

const DELTA_CLASS = [
  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium",
  "data-[good=true]:bg-chip-ok-bg data-[good=true]:text-ok data-[good=false]:bg-chip-bad-bg data-[good=false]:text-bad",
].join(" ");

// N1/FR-028-029/A11Y-1: every tile is clickable and filters to the rows that produced its
// value; urgent/cautionary severity always carries a text label alongside its styling.
export function KpiTile({
  label,
  value,
  sub,
  delta,
  severity = "none",
  onClick,
  isActive = false,
  title,
  icon: Icon,
}: KpiTileProps) {
  return (
    <button
      onClick={onClick}
      data-severity={severity}
      data-active={isActive}
      title={title}
      className={`group ${TILE_CLASS}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow inline-flex items-center gap-1.5">
          {Icon && <Icon aria-hidden className={ICON_CLASS} />}
          {label}
        </span>
        {delta && (
          <span data-good={delta.isGood} className={DELTA_CLASS}>
            {delta.label}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={VALUE_CLASS}>{value}</span>
        {sub && <span className="meta">{sub}</span>}
      </div>
    </button>
  );
}
