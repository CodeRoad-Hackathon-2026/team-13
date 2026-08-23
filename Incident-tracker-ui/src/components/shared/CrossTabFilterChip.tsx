import type { ActiveFilter } from "../../domain/filters";

interface CrossTabFilterChipProps {
  filter: ActiveFilter;
  onClear: () => void;
}

// XT-3 asks for a *distinctly styled* chip when the filter arrived from another tab, so its
// provenance is obvious without reading the toast. Cross-tab chips get the accent fill; a filter
// applied in place on the Now tab stays a quiet neutral outline.
const CHIP_CLASS = [
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-2xs",
  "data-[cross-tab=false]:border-border data-[cross-tab=false]:bg-muted data-[cross-tab=false]:text-muted-foreground",
  "data-[cross-tab=true]:border-p3/40 data-[cross-tab=true]:bg-chip-info-bg data-[cross-tab=true]:text-p3",
].join(" ");

// FR-022/FR-026/XT-3: names the active filter with a one-click clear, rendered distinctly when
// it originated from another tab so its provenance is obvious at a glance.
export function CrossTabFilterChip({ filter, onClear }: CrossTabFilterChipProps) {
  return (
    <span data-cross-tab={filter.isCrossTab} className={CHIP_CLASS}>
      {filter.label}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear filter"
        className="rounded-full px-1 leading-none opacity-60 hover:bg-black/10 hover:opacity-100"
      >
        ×
      </button>
    </span>
  );
}
