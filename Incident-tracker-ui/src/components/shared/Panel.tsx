import type { ReactNode } from "react";
import { SectionHeader } from "./SectionHeader";

interface PanelProps {
  title: string;
  meta?: ReactNode;
  // Set when the panel's own card draws the title in its CardHeader. The heading stays in the
  // accessibility tree — screen readers and tests still find it — it just is not painted twice.
  titleInCard?: boolean;
  children: ReactNode;
}

// A titled slot on the Performance / Knowledge tabs. Deliberately draws no card of its own: the
// card belongs to whatever the panel's PanelBoundary renders, so an error or empty state occupies
// exactly the footprint the chart would have (Principle VIII) instead of nesting inside a frame.
export function Panel({ title, meta, titleInCard = false, children }: PanelProps) {
  return (
    <section className="mt-6">
      {titleInCard ? (
        <h2 className="sr-only">{title}</h2>
      ) : (
        <SectionHeader title={title} meta={meta} />
      )}
      {children}
    </section>
  );
}
