import { useEffect, useRef } from "react";
import { useFocusTrap } from "../../state/useFocusTrap";
import { BUTTON_SECONDARY, SECTION } from "../shared/sectionStyles";

interface DeleteSkillModalProps {
  isOpen: boolean;
  skillName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// The same shape as ApproveConfirmModal: a second explicit click, focus trapped,
// Escape cancels, no click-outside. Removal is the one thing here that cannot be
// undone — switching a skill off is reversible and leaves the row.
//
// The primary button is destructive rather than brand-coloured, and it names what
// goes: a dialog whose confirm button says only "Delete" is a dialog people learn
// to dismiss without reading.
export function DeleteSkillModal({
  isOpen,
  skillName,
  onConfirm,
  onCancel,
}: DeleteSkillModalProps) {
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
        aria-label="Confirm removing a skill"
        ref={containerRef}
        className={`${SECTION} relative w-full max-w-md shadow-xl`}
      >
        <div className="grid gap-3">
          <p className="text-[15px] font-semibold tracking-[-0.2px]">Remove this skill?</p>
          <p className="rounded-lg border border-bad/20 bg-chip-bad-bg px-3 py-2 text-[13px] text-bad">
            {skillName}
          </p>
          <p className="text-[13px] text-muted-foreground">
            This cannot be undone. To stop the agent proposing it while keeping the
            entry, switch it off instead.
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onConfirm}
              className="w-fit rounded-lg bg-bad px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Remove skill
            </button>
            <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
