import { useQuery } from "@tanstack/react-query";
import { fetchActionParameters } from "../../api/incidents/detail";
import type { ProposedChangeData } from "./ProposedChange";

/**
 * The proposed change rides on the action's `parameters` — the JSONB field that
 * already carries "exactly what the tool needs" — so it needs no endpoint of its
 * own, and P-4's lazy fetch still holds: nothing is requested until the panel is
 * opened.
 *
 * Shares its query key with ParametersBlock, so opening the panel makes one
 * request that feeds both.
 */
export function useProposedChange(actionId: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["actions", actionId, "parameters"],
    queryFn: () => fetchActionParameters(actionId),
    enabled,
  });

  return { ...query, change: readChange(query.data?.parameters) };
}

function readChange(parameters: unknown): ProposedChangeData | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const candidate = (parameters as { proposedChange?: unknown }).proposedChange;
  if (typeof candidate !== "object" || candidate === null) return null;

  // Only a change with files is a change. The backend already refuses to store
  // an unparseable diff as one, and this is the second guard on the same rule.
  const files = (candidate as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) return null;

  return candidate as ProposedChangeData;
}
