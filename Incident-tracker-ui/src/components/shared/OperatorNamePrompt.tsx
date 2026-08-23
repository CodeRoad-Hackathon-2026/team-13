import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../state/useFocusTrap";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CONTROL, SECTION } from "./sectionStyles";

interface OperatorNamePromptProps {
  isOpen: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

// FR-120/FR-121/A11Y-3: the first attributed action prompts for a name and does not proceed until
// one is given; useFocusTrap keeps keyboard focus inside while it's open, Esc cancels.
export function OperatorNamePrompt({ isOpen, onSubmit, onCancel }: OperatorNamePromptProps) {
  const [name, setName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/25" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your name"
        ref={containerRef}
        className={`${SECTION} relative w-full max-w-sm shadow-xl`}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed) onSubmit(trimmed);
          }}
          className="grid gap-4"
        >
          <label className="grid gap-1.5">
            <span className="text-[15px] font-semibold tracking-[-0.2px]">What's your name?</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className={FIELD_CONTROL}
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button type="submit" className={BUTTON_PRIMARY}>
              Continue
            </button>
            <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
