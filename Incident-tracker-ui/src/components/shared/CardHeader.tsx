import type { ReactNode } from "react";

interface CardHeaderProps {
  title: string;
  // Right-aligned mono note stating the card's scope — "16 incidents · 7d", "6 runs", "top 4".
  // It answers "what am I looking at the whole of?" without a second heading level, which is the
  // question a reader asks first of any aggregate and which no axis can answer.
  meta?: ReactNode;
  // For a legend or a control that belongs to the chart rather than to the page.
  children?: ReactNode;
}

// A card's own header: title left, scope right, hairline under it.
//
// The heading used to sit outside the card, so a stack of panels read as loose bars of text
// alternating with boxes. Inside, each card is one object you can point at.
export function CardHeader({ title, meta, children }: CardHeaderProps) {
  return (
    <header className="-mx-4 mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-soft px-4 pb-3">
      <h3 className="text-[15px] font-semibold tracking-[-0.2px] text-foreground">{title}</h3>
      {children ?? (meta ? <span className="meta">{meta}</span> : null)}
    </header>
  );
}
