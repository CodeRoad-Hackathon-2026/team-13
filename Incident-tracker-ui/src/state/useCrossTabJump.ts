import { useUrlState } from "./useUrlState";
import type { FilterSelection } from "../domain/filters";

export const INCIDENT_TABLE_FLASH_EVENT = "incident-tracker:flash-incident-table";
export const CROSS_TAB_TOAST_EVENT = "incident-tracker:cross-tab-toast";

export interface CrossTabJumpOptions extends FilterSelection {
  toastMessage: string;
}

// FR-021/FR-023/XT-1/XT-2/XT-4: the single call site every Performance/Knowledge drill-down
// routes through — switches to Now, applies the filter as one atomic transition, flashes+scrolls
// the incident table into view, and announces what happened via a toast.
export function useCrossTabJump() {
  const { crossTabJump } = useUrlState();

  return function jump(options: CrossTabJumpOptions) {
    crossTabJump({ kind: options.kind, key: options.key, label: options.label });
    window.dispatchEvent(new CustomEvent(INCIDENT_TABLE_FLASH_EVENT));
    window.dispatchEvent(new CustomEvent(CROSS_TAB_TOAST_EVENT, { detail: { message: options.toastMessage } }));
  };
}
