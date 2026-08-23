import { formatAge } from "./age";

// N1/FR-008: per-tile delta-is-good-or-bad interpretation for the four Now tiles. All three
// tiles that carry a delta (open incidents, escalated, unassigned) are "lower is better" — a
// rising count is never an improvement.
export type NowTileKey = "openIncidents" | "escalated" | "unassigned";

export interface DeltaDisplay {
  label: string;
  isGood: boolean;
}

export function describeDelta(_tileKey: NowTileKey, delta: number): DeltaDisplay {
  const isGood = delta <= 0;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  return { label: `${arrow} ${Math.abs(delta)}`, isGood };
}

// N1b: Performance's three tiles don't share one direction — resolution time is "lower is
// better" (faster), while automation rate and known-incident hit rate are "higher is better"
// (more automation, more known-incident matches).
export type PerformanceTileKey = "automationRatePercent" | "medianTimeToResolveMinutes" | "knownIncidentHitRate";

const PERFORMANCE_LOWER_IS_BETTER: Record<PerformanceTileKey, boolean> = {
  automationRatePercent: false,
  medianTimeToResolveMinutes: true,
  knownIncidentHitRate: false,
};

export function describePerformanceDelta(tileKey: PerformanceTileKey, delta: number | null): DeltaDisplay | null {
  if (delta === null) return null;
  const lowerIsBetter = PERFORMANCE_LOWER_IS_BETTER[tileKey];
  const isGood = lowerIsBetter ? delta <= 0 : delta >= 0;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  return { label: `${arrow} ${Math.abs(delta)}`, isGood };
}

// N1b: guards the zero-resolved-incidents edge case — median resolve time has no value to show
// rather than a misleading 0m.
export function formatMedianResolveMinutes(value: number | null): string {
  if (value === null) return "No resolved incidents yet";
  return formatAge(value);
}
