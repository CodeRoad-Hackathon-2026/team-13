import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchActionParameters } from "../../api/incidents/detail";
import type { ActionType } from "../../api/types";

interface ParametersBlockProps {
  actionId: string;
  actionType: ActionType;
  // P-4: the request only fires once the panel holding this block is open, never on mount.
  enabled: boolean;
}

function isSqlStatement(value: unknown): value is { statement: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { statement?: unknown }).statement === "string"
  );
}

// FR-035/P-4: parameters are JSONB, fetched only once their panel is opened, then rendered
// monospaced and syntax-highlighted — SQL is pretty-printed first. Both the tokenizer and
// sql-formatter are dynamically imported at that same moment (research.md §8), so neither is
// part of the initial bundle.
export function ParametersBlock({ actionId, actionType, enabled }: ParametersBlockProps) {
  const [rendered, setRendered] = useState<ReactNode[] | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["actions", actionId, "parameters"],
    queryFn: () => fetchActionParameters(actionId),
    enabled,
  });

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      const { renderHighlighted } = await import("./tokenizer");
      let text: string;
      if (actionType === "SQL" && isSqlStatement(data.parameters)) {
        const { format } = await import("sql-formatter");
        text = format(data.parameters.statement);
      } else {
        text = JSON.stringify(data.parameters, null, 2);
      }
      if (!cancelled) setRendered(renderHighlighted(text));
    })();
    return () => {
      cancelled = true;
    };
  }, [data, actionType]);

  return (
    <div>
      {isLoading && <p className="text-[12.5px] text-muted-foreground">Loading parameters…</p>}
      {isError && (
        <p role="alert" className="text-[12.5px] text-bad">
          Could not load parameters.
        </p>
      )}
      {rendered && (
        <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3.5 font-mono text-[12px] leading-relaxed">
          {rendered}
        </pre>
      )}
    </div>
  );
}
