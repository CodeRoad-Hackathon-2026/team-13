import { ageMinutes, formatAge, isAgeFlagged } from "../../domain/age";
import { describeAutomation } from "../../domain/automationIcon";
import { systemClock } from "../../domain/clock";
import { useUrlState } from "../../state/useUrlState";
import { PriorityPill } from "../shared/PriorityPill";
import { StatusPill } from "../shared/StatusPill";
import type { IncidentRow as IncidentRowData } from "../../api/incidents/list";

const SOURCE_ABBREVIATION: Record<IncidentRowData["source"], string> = {
  Email: "EM",
  Slack: "SL",
  PagerDuty: "PD",
  API: "API",
  Manual: "MAN",
};

interface IncidentRowProps {
  incident: IncidentRowData;
}

// IT-1/IT-6/N3: row click opens the drawer via URL state, never a page navigation. Source badge
// in the title cell. Age flagged past its per-priority threshold; escalated/non-prod styling
// always carries a text label (A11Y-1).
export function IncidentRow({ incident }: IncidentRowProps) {
  const { setIncident } = useUrlState();
  const minutes = ageMinutes(incident.createdAt, systemClock);
  const flagged = isAgeFlagged(incident.createdAt, incident.priority, systemClock);
  const automation = describeAutomation(incident.automationStatus);
  const open = () => setIncident(incident.id);

  return (
    <tr
      tabIndex={0}
      // IT-1: the whole row is the hit target and it opens the drawer — never a navigation — so
      // it gets pointer affordance without ever becoming a link.
      className="cursor-pointer border-b border-border-soft transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-middle"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") open();
      }}
    >
      <td>
        <PriorityPill priority={incident.priority} />
      </td>
      <td>
        <StatusPill status={incident.status} />
      </td>
      <td title={incident.title} className="max-w-[380px] truncate">
        <span className="mr-2 rounded bg-muted px-1 py-px font-mono text-[10px] font-semibold text-subtle-foreground">
          {SOURCE_ABBREVIATION[incident.source]}
        </span>
        {incident.title}
      </td>
      <td className="text-muted-foreground">{incident.serviceName}</td>
      {/* A11Y-1: non-production is de-emphasised, but the environment name is still spelled out. */}
      <td
        data-nonprod={incident.environment !== "Production"}
        className="text-muted-foreground data-[nonprod=true]:text-subtle-foreground data-[nonprod=true]:italic"
      >
        {incident.environment}
      </td>
      <td className="text-muted-foreground">{incident.category}</td>
      <td>
        {incident.isKnownIncident ? (
          <span className="text-ok">
            ✓{" "}
            <span className="font-mono text-[12px] tabular-nums">
              {incident.bestMatchScore?.toFixed(2)}
            </span>
          </span>
        ) : (
          <span className="text-subtle-foreground">—</span>
        )}
      </td>
      <td className="meta tabular-nums">
        {incident.confidenceScore != null ? incident.confidenceScore.toFixed(2) : "—"}
      </td>
      {/* IT-6: past its per-priority threshold the age turns red *and* bold — never colour alone. */}
      <td
        data-flagged={flagged}
        className="whitespace-nowrap text-muted-foreground data-[flagged=true]:font-bold data-[flagged=true]:text-bad"
      >
        {formatAge(minutes)}
      </td>
      <td className="text-muted-foreground">
        {incident.assignedTo ?? (
          <span data-warning="true" className="font-medium text-warn">
            Unassigned
          </span>
        )}
      </td>
      <td title={automation.label} className="text-center">
        {automation.icon}
      </td>
    </tr>
  );
}
