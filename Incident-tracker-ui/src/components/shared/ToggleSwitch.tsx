interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  // Shown beside the switch. Present because a switch whose state is carried
  // only by its position is colour-and-shape alone (AR-1/A11Y-1) — and because
  // "On" next to a skill reads faster than a knob does.
  showStateText?: boolean;
}

const TRACK =
  "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border border-transparent bg-input transition-colors aria-checked:bg-primary disabled:pointer-events-none disabled:opacity-45";
const KNOB =
  "pointer-events-none absolute left-[3px] size-[16px] rounded-full bg-card shadow-sm transition-transform";

export function ToggleSwitch({
  label,
  checked,
  onChange,
  disabled = false,
  showStateText = true,
}: ToggleSwitchProps) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {showStateText && (
        <span aria-hidden="true" className="meta w-[1.9rem] text-right">
          {checked ? "On" : "Off"}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={TRACK}
      >
        <span
          className={KNOB}
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </button>
    </span>
  );
}
