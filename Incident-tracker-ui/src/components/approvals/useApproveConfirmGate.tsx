import { useState } from "react";
import type { RiskLevel } from "../../api/types";
import { ApproveConfirmModal } from "./ApproveConfirmModal";

// FR-037: HIGH risk requires the second explicit click; LOW/MEDIUM approve on the first click,
// never seeing this modal at all.
export function useApproveConfirmGate(actionDescription: string) {
  const [pendingConfirm, setPendingConfirm] = useState<(() => void) | null>(null);

  function requestApprove(riskLevel: RiskLevel, confirm: () => void) {
    if (riskLevel !== "HIGH") {
      confirm();
      return;
    }
    setPendingConfirm(() => confirm);
  }

  const confirmModal = (
    <ApproveConfirmModal
      isOpen={pendingConfirm !== null}
      actionDescription={actionDescription}
      onConfirm={() => {
        pendingConfirm?.();
        setPendingConfirm(null);
      }}
      onCancel={() => setPendingConfirm(null)}
    />
  );

  return { requestApprove, confirmModal };
}
