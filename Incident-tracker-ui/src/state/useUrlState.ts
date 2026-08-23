import { useCallback, useSyncExternalStore } from "react";
import {
  clearFilter as clearFilterDomain,
  crossTabJump as crossTabJumpDomain,
  setFilter as setFilterDomain,
  setTab as setTabDomain,
  type ActiveFilter,
  type DashboardViewState,
  type FilterKind,
  type FilterSelection,
  type Tab,
  type TimeRange,
} from "../domain/filters";

export interface UrlState extends DashboardViewState {
  incidentId: string | null;
}

const VALID_TABS: readonly Tab[] = ["now", "performance", "agent", "knowledge"];
const VALID_RANGES: readonly TimeRange[] = ["24h", "7d", "30d", "all"];

const listeners = new Set<() => void>();
let cachedSearch: string | null = null;
let cachedState: UrlState | null = null;

function parseState(): UrlState {
  const search = window.location.search;
  if (cachedState && cachedSearch === search) {
    return cachedState;
  }

  const params = new URLSearchParams(search);
  const tabParam = params.get("tab");
  const tab: Tab = (VALID_TABS as string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "now";
  const rangeParam = params.get("range");
  const timeRange: TimeRange = (VALID_RANGES as string[]).includes(rangeParam ?? "")
    ? (rangeParam as TimeRange)
    : "7d";
  const envParam = params.get("env");
  const environment = envParam ? envParam.split(",").filter(Boolean) : ["Production"];
  const service = params.get("service") || null;
  const query = params.get("q") ?? "";
  const includeResolved = params.get("includeResolved") === "true";
  const incidentId = params.get("incident") || null;

  const filterKind = params.get("filterKind") as FilterKind | null;
  const filterKey = params.get("filterKey");
  const filterLabel = params.get("filterLabel");
  const filterCrossTab = params.get("filterCrossTab") === "true";
  const activeFilter: ActiveFilter | null =
    filterKind && filterKey && filterLabel
      ? { kind: filterKind, key: filterKey, label: filterLabel, isCrossTab: filterCrossTab }
      : null;

  cachedSearch = search;
  cachedState = {
    tab,
    timeRange,
    environment,
    service,
    search: query,
    includeResolved,
    activeFilter,
    incidentId,
  };
  return cachedState;
}

function serialize(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.tab !== "now") params.set("tab", state.tab);
  if (state.timeRange !== "7d") params.set("range", state.timeRange);
  if (!(state.environment.length === 1 && state.environment[0] === "Production")) {
    params.set("env", state.environment.join(","));
  }
  if (state.service) params.set("service", state.service);
  if (state.search) params.set("q", state.search);
  if (state.includeResolved) params.set("includeResolved", "true");
  if (state.incidentId) params.set("incident", state.incidentId);
  if (state.activeFilter) {
    params.set("filterKind", state.activeFilter.kind);
    params.set("filterKey", state.activeFilter.key);
    params.set("filterLabel", state.activeFilter.label);
    if (state.activeFilter.isCrossTab) params.set("filterCrossTab", "true");
  }
  return params.toString();
}

function writeUrl(state: UrlState) {
  const query = serialize(state);
  const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, "", url);
  // replaceState doesn't fire popstate, so notify subscribers ourselves.
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function useUrlState() {
  const state = useSyncExternalStore(subscribe, parseState, parseState);

  const update = useCallback((updater: (prev: UrlState) => UrlState) => {
    writeUrl(updater(parseState()));
  }, []);

  return {
    ...state,
    setTab: useCallback((tab: Tab) => update((prev) => setTabDomain(prev, tab) as UrlState), [update]),
    setTimeRange: useCallback((timeRange: TimeRange) => update((prev) => ({ ...prev, timeRange })), [update]),
    setEnvironment: useCallback((environment: string[]) => update((prev) => ({ ...prev, environment })), [update]),
    setService: useCallback((service: string | null) => update((prev) => ({ ...prev, service })), [update]),
    setSearch: useCallback((search: string) => update((prev) => ({ ...prev, search })), [update]),
    setIncludeResolved: useCallback(
      (includeResolved: boolean) => update((prev) => ({ ...prev, includeResolved })),
      [update],
    ),
    setIncident: useCallback((incidentId: string | null) => update((prev) => ({ ...prev, incidentId })), [update]),
    setFilter: useCallback(
      (filter: FilterSelection) => update((prev) => setFilterDomain(prev, filter) as UrlState),
      [update],
    ),
    crossTabJump: useCallback(
      (filter: FilterSelection) => update((prev) => crossTabJumpDomain(prev, filter) as UrlState),
      [update],
    ),
    clearFilter: useCallback(() => update((prev) => clearFilterDomain(prev) as UrlState), [update]),
  };
}
