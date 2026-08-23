import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "incident-tracker:operator-name";
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.7;

interface OperatorContextValue {
  operatorName: string | null;
  setOperatorName: (name: string) => void;
  lowConfidenceThreshold: number;
}

const OperatorContext = createContext<OperatorContextValue | null>(null);

export function OperatorProvider({
  children,
  lowConfidenceThreshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
}: {
  children: ReactNode;
  lowConfidenceThreshold?: number;
}) {
  const [operatorName, setOperatorNameState] = useState<string | null>(() =>
    window.localStorage.getItem(STORAGE_KEY),
  );

  const setOperatorName = useCallback((name: string) => {
    window.localStorage.setItem(STORAGE_KEY, name);
    setOperatorNameState(name);
  }, []);

  const value = useMemo(
    () => ({ operatorName, setOperatorName, lowConfidenceThreshold }),
    [operatorName, setOperatorName, lowConfidenceThreshold],
  );

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorContextValue {
  const ctx = useContext(OperatorContext);
  if (!ctx) {
    throw new Error("useOperator must be used within an OperatorProvider");
  }
  return ctx;
}
