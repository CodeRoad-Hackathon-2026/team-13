import { useState } from "react";
import { useOperator } from "../../state/OperatorContext";
import { OperatorNamePrompt } from "./OperatorNamePrompt";

// FR-119/FR-120: every attributed action (approve, reject, ...) routes through this gate. With a
// name already on file it runs immediately; otherwise it does not run at all until one is
// supplied — never with a placeholder, never partially.
export function useOperatorNameGate() {
  const { operatorName, setOperatorName } = useOperator();
  const [pendingAction, setPendingAction] = useState<((name: string) => void) | null>(null);

  function requireOperatorName(action: (name: string) => void) {
    if (operatorName) {
      action(operatorName);
      return;
    }
    setPendingAction(() => action);
  }

  const operatorNamePrompt = (
    <OperatorNamePrompt
      isOpen={pendingAction !== null}
      onSubmit={(name) => {
        setOperatorName(name);
        pendingAction?.(name);
        setPendingAction(null);
      }}
      onCancel={() => setPendingAction(null)}
    />
  );

  return { requireOperatorName, operatorNamePrompt };
}
