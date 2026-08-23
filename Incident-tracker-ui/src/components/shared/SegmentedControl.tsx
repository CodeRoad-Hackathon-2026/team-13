interface Option<T extends string> {
  value: T;
  label: string;
  // Set when the server will refuse this value. Rendered visibly disabled with
  // the reason, rather than hidden: an option that is missing looks like it was
  // never designed, and an operator wondering where "act autonomously" went
  // learns nothing.
  disabledReason?: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
}

// role="group" with aria-pressed buttons, not a tablist and not a radiogroup:
// this is the pattern the time-range control in DashboardHeader already
// established, and the constitution records a deliberate decision to hand-roll
// ARIA here rather than pull in a primitive.
const TRACK = "inline-flex flex-wrap items-center gap-1 rounded-[10px] bg-muted p-1";
const OPTION =
  "rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-all hover:text-foreground aria-pressed:bg-card aria-pressed:font-semibold aria-pressed:text-foreground aria-pressed:shadow-sm disabled:pointer-events-none disabled:opacity-45";

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={TRACK}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled || Boolean(option.disabledReason)}
          // The reason travels with the control, so it is reachable by hover and
          // by a screen reader without a separate tooltip component.
          title={option.disabledReason}
          aria-description={option.disabledReason}
          onClick={() => onChange(option.value)}
          className={OPTION}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
