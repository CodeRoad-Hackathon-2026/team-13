// FR-025/FR-026: at most one filter active at a time across all tabs; a new selection replaces
// the previous one rather than accumulating. FR-020/TB-5: switching tabs never clears it.
// Extended by US3 (T131) with the cross-tab jump transition.

export type Tab = "now" | "performance" | "agent" | "knowledge";
export type TimeRange = "24h" | "7d" | "30d" | "all";
export type FilterKind = "kpiTile" | "funnelDropAt" | "funnelStage" | "breakdown" | "candidate";

export interface ActiveFilter {
  kind: FilterKind;
  key: string;
  label: string;
  // FR-022/XT-3: a chip that originated from another tab renders in a visually distinct style, so
  // its provenance is obvious at a glance.
  isCrossTab: boolean;
}

export type FilterSelection = Omit<ActiveFilter, "isCrossTab">;

export interface DashboardViewState {
  tab: Tab;
  timeRange: TimeRange;
  environment: string[];
  service: string | null;
  search: string;
  includeResolved: boolean;
  activeFilter: ActiveFilter | null;
}

// A same-tab filter selection (e.g. a Now-tab KPI tile, clicked while already on Now).
export function setFilter(state: DashboardViewState, filter: FilterSelection): DashboardViewState {
  return { ...state, activeFilter: { ...filter, isCrossTab: false } };
}

export function clearFilter(state: DashboardViewState): DashboardViewState {
  return { ...state, activeFilter: null };
}

export function setTab(state: DashboardViewState, tab: Tab): DashboardViewState {
  return { ...state, tab };
}

// FR-021/FR-025: a funnel-stage or breakdown-segment click is one atomic transition — switching
// to Now and applying the filter together — never a separate tab-switch-then-filter that could be
// observed mid-way or interrupted. Distinct from setFilter: this always lands on Now and always
// marks the resulting chip as cross-tab-originated (FR-022).
export function crossTabJump(state: DashboardViewState, filter: FilterSelection): DashboardViewState {
  return { ...state, tab: "now", activeFilter: { ...filter, isCrossTab: true } };
}
