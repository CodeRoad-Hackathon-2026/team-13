import type { DocumentDrivingResolution } from "../../api/dashboard/knowledge";
import { AccessibleChartTable } from "../shared/AccessibleChartTable";

interface DocumentsDrivingResolutionsProps {
  documents: DocumentDrivingResolution[];
}

// FR-102/K3: which documents earn their place — ranked by linked resolution count. The server
// already pre-sorts descending; this re-sort is a defensive no-op guarantee, not a trust issue.
export function DocumentsDrivingResolutions({ documents }: DocumentsDrivingResolutionsProps) {
  const sorted = [...documents].sort((a, b) => b.resolutionCount - a.resolutionCount);

  return (
    <section
      aria-label="Documents driving resolutions"
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <ol>
        {sorted.map((doc) => (
          <li
            key={doc.documentId}
            className="flex flex-wrap items-center gap-2.5 border-t border-border-soft py-2.5 text-[13px] first:border-t-0 first:pt-0"
          >
            <span className="rounded bg-muted px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {doc.documentType}
            </span>
            <span className="min-w-0 flex-1 truncate">{doc.title}</span>
            <span className="meta tabular-nums">{doc.resolutionCount} resolutions</span>
          </li>
        ))}
      </ol>
      <AccessibleChartTable
        caption="Documents driving resolutions, descending"
        columns={[
          { key: "title", label: "Document" },
          { key: "documentType", label: "Type" },
          { key: "resolutionCount", label: "Resolutions" },
        ]}
        rows={sorted.map((d) => ({
          title: d.title,
          documentType: d.documentType,
          resolutionCount: d.resolutionCount,
        }))}
      />
    </section>
  );
}
