import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, Search } from "lucide-react";
import { useIncidentList } from "../../api/incidents/list";
import { useUrlState } from "../../state/useUrlState";
import { INCIDENT_TABLE_FLASH_EVENT } from "../../state/useCrossTabJump";
import { PanelBoundary } from "../shared/PanelBoundary";
import { CrossTabFilterChip } from "../shared/CrossTabFilterChip";
import { IncidentRow } from "./IncidentRow";
import { SectionHeader } from "../shared/SectionHeader";

type SortKey = "priority" | "age" | "confidence";
const FLASH_DURATION_MS = 1500;

// FR-048-057, P-3: server-side filter/sort/page. Also the destination every cross-tab jump
// flashes and scrolls into view (id="incident-table" is that target).
export function IncidentTable() {
  const {
    environment,
    service,
    search,
    includeResolved,
    activeFilter,
    setSearch,
    setIncludeResolved,
    clearFilter,
  } = useUrlState();
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleFlash() {
      const node = containerRef.current;
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      node.setAttribute("data-flash", "true");
      setTimeout(() => node.removeAttribute("data-flash"), FLASH_DURATION_MS);
    }
    window.addEventListener(INCIDENT_TABLE_FLASH_EVENT, handleFlash);
    return () => window.removeEventListener(INCIDENT_TABLE_FLASH_EVENT, handleFlash);
  }, []);

  const { data, isLoading, isError, error, refetch } = useIncidentList({
    environment,
    service,
    q: search,
    includeResolved,
    sort: sortKey,
    kpiTile: activeFilter?.kind === "kpiTile" ? activeFilter.key : undefined,
    funnelDropAt: activeFilter?.kind === "funnelDropAt" ? activeFilter.key : undefined,
    funnelStage: activeFilter?.kind === "funnelStage" ? activeFilter.key : undefined,
    breakdown: activeFilter?.kind === "breakdown" ? activeFilter.key : undefined,
  });

  const isFiltered = Boolean(search) || Boolean(activeFilter);

  return (
    // XT-2: `data-flash` is toggled imperatively by the cross-tab jump handler above; the ring
    // below is the whole visual payload of that flash.
    <div id="incident-table" ref={containerRef} className="group mt-8 scroll-mt-[180px]">
      <SectionHeader title="Incidents" meta={data ? `${data.totalCount} in scope` : undefined} />
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow group-data-[flash=true]:ring-2 group-data-[flash=true]:ring-ring">
        <div className="flex flex-wrap items-center gap-4 border-b border-border bg-muted px-4 py-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground"
            />
            <input
              placeholder="Search title, service, or external ID…"
              className="w-72 rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-[13px] shadow-2xs transition-all placeholder:text-subtle-foreground focus-visible:border-ring/50 focus-visible:shadow-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(event) => setIncludeResolved(event.target.checked)}
            />
            Include resolved
          </label>
          {activeFilter && <CrossTabFilterChip filter={activeFilter} onClear={clearFilter} />}
        </div>
        {/*
        PanelBoundary renders its state directly here, so inset everything it can emit — skeleton,
        error, both empty states — off the card edge. The row-count footer opts out: it draws its
        own full-bleed top rule.
      */}
        <div className="[&>div:not([data-slot=row-count])]:m-4">
          <PanelBoundary
            isLoading={isLoading}
            isError={isError}
            errorMessage={(error as Error | undefined)?.message}
            onRetry={refetch}
            data={data}
            isEmpty={(d) => d.rows.length === 0}
            isFiltered={isFiltered}
            emptyNoDataMessage="Incidents arrive from email, PagerDuty, Slack, and the API."
            emptyFilteredMessage="No incidents match these filters."
            onClearFilters={() => {
              setSearch("");
              clearFilter();
            }}
            skeleton={
              <div className="px-3.5 py-8 text-center text-[13px] text-muted-foreground">
                Loading incidents…
              </div>
            }
          >
            {(list) => (
              <>
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="[&>th]:border-b [&>th]:border-border [&>th]:bg-muted [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.08em] [&>th]:text-subtle-foreground">
                      <th
                        aria-sort={sortKey === "priority" ? "ascending" : "none"}
                        onClick={() => setSortKey("priority")}
                        className="cursor-pointer select-none hover:text-foreground aria-[sort=ascending]:text-foreground"
                      >
                        <span className="inline-flex items-center gap-1">
                          Pri
                          <ArrowUpDown aria-hidden="true" className="size-3 opacity-50" />
                        </span>
                      </th>
                      <th>Status</th>
                      <th>Title</th>
                      <th>Service</th>
                      <th>Env</th>
                      <th>Category</th>
                      <th>Known</th>
                      <th
                        aria-sort={sortKey === "confidence" ? "ascending" : "none"}
                        onClick={() => setSortKey("confidence")}
                        className="cursor-pointer select-none hover:text-foreground aria-[sort=ascending]:text-foreground"
                      >
                        <span className="inline-flex items-center gap-1">
                          AI conf.
                          <ArrowUpDown aria-hidden="true" className="size-3 opacity-50" />
                        </span>
                      </th>
                      <th
                        aria-sort={sortKey === "age" ? "ascending" : "none"}
                        onClick={() => setSortKey("age")}
                        className="cursor-pointer select-none hover:text-foreground aria-[sort=ascending]:text-foreground"
                      >
                        <span className="inline-flex items-center gap-1">
                          Age
                          <ArrowUpDown aria-hidden="true" className="size-3 opacity-50" />
                        </span>
                      </th>
                      <th>Assignee</th>
                      <th>Auto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((row) => (
                      <IncidentRow key={row.id} incident={row} />
                    ))}
                  </tbody>
                </table>
                <div
                  data-slot="row-count"
                  className="border-t border-border-soft px-3.5 py-2.5 text-[11.5px] text-subtle-foreground"
                >
                  Showing {list.rows.length} of {list.totalCount} · page {list.page}
                </div>
              </>
            )}
          </PanelBoundary>
        </div>
      </div>
    </div>
  );
}
