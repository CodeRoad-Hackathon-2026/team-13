import { useEffect, useRef } from "react";
import { useFocusTrap } from "../../state/useFocusTrap";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, SECTION } from "../shared/sectionStyles";

interface ApproveConfirmModalProps {
  isOpen: boolean;
  actionDescription: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// FR-037/§11.2/A11Y-3: restates the action and requires a second explicit click. Only ever opened
// for a HIGH-risk action — the risk check itself lives in useApproveConfirmGate. Esc cancels,
// matching the detail drawer's own modal dismissal.
export function ApproveConfirmModal({ isOpen, actionDescription, onConfirm, onCancel }: ApproveConfirmModalProps) {
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
        aria-label="Confirm high-risk action"
        ref={containerRef}
        className={`${SECTION} relative w-full max-w-md shadow-xl`}
      >
        <div className="grid gap-3">
          <p className="text-[15px] font-semibold tracking-[-0.2px]">
            This is a HIGH-risk action. Please confirm:
          </p>
          <p className="rounded-lg border border-bad/20 bg-chip-bad-bg px-3 py-2 text-[13px] text-bad">
            {actionDescription}
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className={BUTTON_PRIMARY} onClick={onConfirm}>
              Confirm approve
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
