import { useState } from "react";
import { ChevronRight } from "lucide-react";

interface Column<T> {
  key: keyof T;
  label: string;
}

interface AccessibleChartTableProps<T> {
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
}

// A11Y-4: every chart offers an accessible tabular equivalent, fed the same domain-computed
// series as its chart sibling, toggled visible rather than always shown.
export function AccessibleChartTable<T extends Record<string, unknown>>({
  caption,
  columns,
  rows,
}: AccessibleChartTableProps<T>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="mt-3 border-t border-border-soft pt-3">
      <button
        aria-expanded={visible}
        onClick={() => setVisible((v) => !v)}
        className="group -mx-1.5 flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:text-foreground"
      >
        <ChevronRight
          aria-hidden="true"
          className="size-3 shrink-0 text-subtle-foreground transition-transform duration-150 group-aria-expanded:rotate-90 group-aria-expanded:text-foreground"
        />
        {visible ? "Hide table view" : "View as table"}
      </button>
      {visible && (
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <caption className="eyebrow mb-2 text-left">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  className="border-b border-border px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-subtle-foreground"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-border-soft last:border-b-0">
                {columns.map((column) => (
                  <td key={String(column.key)} className="px-2 py-1.5">
                    {String(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
