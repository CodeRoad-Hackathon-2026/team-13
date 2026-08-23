import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchIncidentEvents } from "../../api/incidents/detail";
import type { IncidentDetail } from "../../api/incidents/detail";
import { cumulativeElapsed } from "../../domain/timeline";
import { RelativeTime } from "../shared/RelativeTime";
import { BUTTON_SECONDARY, MUTED_NOTE, SECTION, SECTION_TITLE } from "../shared/sectionStyles";

interface EventTimelineProps {
  incidentId: string;
  incidentCreatedAt: string;
  events: IncidentDetail["events"];
}

const EVENT_ICON: Record<IncidentDetail["events"][number]["eventType"], string> = {
  INCIDENT_CREATED: "🆕",
  EMAIL_RECEIVED: "📧",
  INCIDENT_CLASSIFIED: "🏷️",
  RAG_SEARCH_STARTED: "🔍",
  RAG_SEARCH_COMPLETED: "🔎",
  SIMILAR_INCIDENT_FOUND: "🧩",
  ACTION_RECOMMENDED: "💡",
  DEVELOPER_NOTIFIED: "🔔",
  ACTION_APPROVED: "✅",
  ACTION_REJECTED: "🚫",
  ACTION_EXECUTED: "⚙️",
  VALIDATION_FAILED: "⚠️",
  ESCALATED: "🚨",
};

// FR-069-072: chronological timeline, icon per event type, relative + absolute timestamps, actor,
// cumulative elapsed time, failure events flagged with a text label, and a server-side (TL-1, not
// client-filtered) "agent events only" toggle.
export function EventTimeline({ incidentId, incidentCreatedAt, events }: EventTimelineProps) {
  const [agentOnly, setAgentOnly] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["incidents", incidentId, "events", agentOnly],
    queryFn: () => fetchIncidentEvents(incidentId, agentOnly),
    initialData: agentOnly ? undefined : { events },
  });

  return (
    <section aria-label="Event timeline" className={`${SECTION} shadow-xs`}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className={`${SECTION_TITLE} mb-0`}>Event timeline</h3>
        {/* TL-1: this refetches server-side; it is not a client-side filter of a loaded list. */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={agentOnly}
            onChange={(e) => setAgentOnly(e.target.checked)}
          />
          Agent events only
        </label>
      </div>
      {isLoading && <p className={MUTED_NOTE}>Loading events…</p>}
      {isError && (
        <div
          role="alert"
          className="grid gap-2 rounded-md border border-bad/20 bg-chip-bad-bg p-2.5"
        >
          <p className="text-[12.5px] text-bad">
            {(error as Error | undefined)?.message ?? "Could not load events."}
          </p>
          <button onClick={() => refetch()} className={BUTTON_SECONDARY}>
            Retry
          </button>
        </div>
      )}
      {data && data.events.length === 0 && (
        <p className={MUTED_NOTE}>No events recorded for this incident.</p>
      )}
      {data && data.events.length > 0 && (
        <ol className="grid gap-1">
          {data.events.map((event) => (
            // FR-072: a failure event is tinted *and* labelled "Failed" — never colour alone.
            <li
              key={event.id}
              data-failure={event.isFailureEvent}
              className="flex flex-wrap items-baseline gap-2 rounded-md px-2 py-1.5 text-[12.5px] odd:bg-secondary data-[failure=true]:bg-chip-bad-bg"
            >
              <span aria-hidden="true">{EVENT_ICON[event.eventType]}</span>
              <p className="font-medium">{event.description}</p>
              <span className="text-subtle-foreground">{event.createdBy}</span>
              <span className="ml-auto text-[11.5px] text-subtle-foreground">
                <RelativeTime timestamp={event.createdAt} />
              </span>
              <span className="font-mono text-[11px] text-subtle-foreground">
                {cumulativeElapsed(event.createdAt, incidentCreatedAt)}
              </span>
              {event.isFailureEvent && (
                <span
                  data-failure="true"
                  className="rounded bg-bad px-1.5 py-px text-[10.5px] font-bold uppercase text-white"
                >
                  Failed
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
