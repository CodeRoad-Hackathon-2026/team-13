import type { AutomationStatus } from "../api/types";

export interface AutomationDisplay {
  icon: string;
  label: string;
}

// N3/A11Y-1: maps the server-computed automationStatus to an icon plus a text label — the label
// is never omitted, since colour/icon alone is never the sole carrier of meaning.
const DISPLAY: Record<AutomationStatus, AutomationDisplay> = {
  fully_automated: { icon: "🤖", label: "Fully automated" },
  human_approved: { icon: "👤", label: "Human-approved" },
  needs_human: { icon: "⚠️", label: "Needs human" },
  none: { icon: "—", label: "No automation" },
};

export function describeAutomation(status: AutomationStatus): AutomationDisplay {
  return DISPLAY[status];
}
