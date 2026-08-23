import type { IncidentDetail } from "../../api/incidents/detail";
import { PriorityPill } from "../shared/PriorityPill";
import { StatusPill } from "../shared/StatusPill";
import { BUTTON_SECONDARY, MUTED_NOTE, SECTION } from "../shared/sectionStyles";

interface IncidentHeaderActionsProps {
  incident: IncidentDetail["incident"];
}

const DISABLED_REASON = "Incident updates are not available yet.";

// FR-060/FR-061/FR-062: header metadata plus the four update actions, visibly disabled with a
// stated reason (never hidden, never silently succeeding) until the incident-update API exists.
export function IncidentHeaderActions({ incident }: IncidentHeaderActionsProps) {
  return (
    <header className={`${SECTION} grid gap-2.5 shadow-xs`}>
      <p className="font-mono text-[11.5px] text-subtle-foreground">{incident.externalId}</p>
      <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.3px]">{incident.title}</h2>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <StatusPill status={incident.status} />
        <PriorityPill priority={incident.priority} />
        <span>{incident.serviceName}</span>
        <span
          data-nonprod={incident.environment !== "Production"}
          className="data-[nonprod=true]:italic data-[nonprod=true]:text-subtle-foreground"
        >
          {incident.environment}
        </span>
        <span>
          {incident.assignedTo ?? (
            <span data-warning="true" className="font-medium text-warn">
              Unassigned
            </span>
          )}
        </span>
        <span className="text-subtle-foreground">Source: {incident.source}</span>
      </div>
      <div className="flex flex-wrap gap-4 text-[11.5px] text-subtle-foreground">
        <span>Created {incident.createdAt}</span>
        <span>Resolved {incident.resolvedAt ?? "—"}</span>
      </div>
      {/* FR-062: disabled, never hidden — and the reason is stated in text next to the controls. */}
      <div role="group" aria-label="Incident actions" className="flex flex-wrap items-center gap-2">
        {["Assign to me", "Change priority", "Escalate", "Mark resolved"].map((label) => (
          <button
            key={label}
            type="button"
            disabled
            title={DISABLED_REASON}
            aria-disabled="true"
            className={BUTTON_SECONDARY}
          >
            {label}
          </button>
        ))}
        <p className={`${MUTED_NOTE} basis-full text-[11.5px]`}>{DISABLED_REASON}</p>
      </div>
    </header>
  );
}
