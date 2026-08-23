import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  // Right-aligned mono counter — the design's way of stating scope ("3 of 3 awaiting review")
  // without adding a second heading level.
  meta?: ReactNode;
}

export function SectionHeader({ title, meta }: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[15px] font-semibold tracking-[-0.2px] text-foreground">{title}</h2>
      {meta && <span className="meta">{meta}</span>}
    </div>
  );
}
