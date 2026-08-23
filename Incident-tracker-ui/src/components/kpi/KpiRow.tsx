import type { ReactNode } from "react";

// Each tile is its own elevated card with a gap between, rather than one bordered strip split by
// hairlines — gives every KPI a bit of individual identity (its own hover lift, its own severity
// accent) while `auto-cols-fr` still keeps them equal width for any tile count, so the three
// strips (Now/Performance/Knowledge) share this wrapper without configuring a column count. Below
// `md` it drops to a 2-column grid rather than letting four tiles get crushed into one row.
export function KpiRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-flow-col md:auto-cols-fr md:grid-cols-none">
      {children}
    </div>
  );
}
