// Shared Tailwind class strings for the stacked panels in the drawer and the Performance /
// Knowledge tabs. One place so every panel reads as the same card, and so a spacing change is one
// edit rather than twenty. Pure constants — no components — so it stays outside the
// react-refresh boundary.
//
// These encode the canvas design's rules: hairline borders on white, no tinted panels, uppercase
// letter-spaced eyebrows for labels, mono for every metadatum and number.

// No shadow baked in here on purpose: a couple of callers (the two confirmation modals) need a
// stronger elevation than the rest, and stacking two `shadow-*` utilities on one element has
// undefined winner ordering in Tailwind's generated stylesheet. Everyone else appends their own
// `shadow-xs` (or nothing) at the call site instead.
export const SECTION = "rounded-xl border border-border bg-card p-4";

export const SECTION_TITLE = "mb-3 text-[15px] font-semibold tracking-[-0.2px] text-foreground";

export const EYEBROW = "eyebrow";

export const META = "meta";

export const DISCLOSURE =
  "flex w-fit items-center gap-1.5 rounded-md py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground aria-expanded:text-foreground [&_svg]:transition-transform [&_svg]:duration-150 aria-expanded:[&_svg]:rotate-90";

export const CODE_BLOCK =
  "overflow-x-auto rounded-lg border border-border-soft bg-muted p-3 font-mono text-[12px] leading-relaxed";

export const MUTED_NOTE = "text-[13px] text-muted-foreground";

export const ALERT_NOTE = "text-[13px] font-medium text-bad";

export const FIELD_LABEL = "grid gap-1.5 text-[13px] font-medium text-muted-foreground";

export const FIELD_CONTROL =
  "rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-normal text-foreground shadow-2xs transition-all focus-visible:border-ring/50 focus-visible:shadow-sm";

export const BUTTON_PRIMARY =
  "w-fit rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary-hover hover:shadow-md active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none";

export const BUTTON_SECONDARY =
  "w-fit rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-muted-foreground shadow-2xs transition-all hover:border-border hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none";

// A hairline meter track + its fill, used by the similarity and feedback-impact bars alike.
export const METER_TRACK = "h-[5px] w-full overflow-hidden rounded-full bg-muted";
export const METER_FILL = "h-full rounded-full bg-primary transition-[width] duration-300";

// The chart bar. Ink, not brand colour: a page of charts where every bar is the same saturated
// hue spends its loudest channel on nothing, so a bar that IS coloured — a priority, a status —
// stops meaning anything. Ink for magnitude, colour only where colour is the point.
export const BAR_TRACK = "block h-1.5 w-full overflow-hidden rounded-full bg-border-soft";
// `block` is load-bearing: these are spans at some call sites, and an inline element ignores
// h-full, so the fill renders with the right colour and width and zero height.
export const BAR_FILL = "block h-full rounded-full bg-chart-ink transition-[width] duration-300";
// For the row that is an absence rather than a thing: "Uncategorised", "Unknown".
export const BAR_FILL_MUTED =
  "block h-full rounded-full bg-chart-ink-muted transition-[width] duration-300";

// An inset row inside a panel: the design separates list items with hairlines rather than
// wrapping each one in its own tinted box.
export const ROW = "border-t border-border-soft py-2.5 first:border-t-0 first:pt-0";
