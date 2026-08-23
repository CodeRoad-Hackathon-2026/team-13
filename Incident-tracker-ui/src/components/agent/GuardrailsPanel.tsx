import { dayName, useGuardrails } from "../../api/agents/guardrails";
import { CardHeader } from "../shared/CardHeader";
import { SECTION } from "../shared/sectionStyles";

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    // A div inside a dl may hold only dt/dd groups, so the note lives inside the
    // dd rather than beside it — it is part of the value's explanation anyway.
    <div className="border-t border-border-soft py-2.5 first:border-t-0 first:pt-0">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">
        <span className="meta block text-foreground">{value}</span>
        {note && <span className="mt-0.5 block text-[12px] text-subtle-foreground">{note}</span>}
      </dd>
    </div>
  );
}

// What bounds every agent, not just the one selected. Read-only here on purpose:
// each of these is enforced by the policy gate, and the three that matter most
// are set on the server. Showing them is the point — an operator seeing a
// proposal deferred needs somewhere that explains why.
export function GuardrailsPanel() {
  const { data, isLoading, isError } = useGuardrails();

  return (
    <section aria-label="Guardrails" className={`${SECTION} shadow-xs`}>
      <CardHeader title="Guardrails" meta="all agents" />
      {isLoading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="text-[13px] text-muted-foreground">
          Could not read the guardrails. They are still in force — this panel is the
          only thing that failed.
        </p>
      )}
      {data && (
        <dl>
          <Row
            label="Max concurrent executions"
            value={String(data.maxConcurrentExecutions)}
            note="At the ceiling, an auto-run action waits for a person instead of being dropped."
          />
          <Row
            label="Blackout window"
            value={
              data.blackout
                ? `${dayName(data.blackout.startDow)} ${data.blackout.startTime} — ${dayName(data.blackout.endDow)} ${data.blackout.endTime}`
                : "none"
            }
            note={
              data.blackout
                ? "Nothing runs unattended inside it. Proposals still arrive."
                : undefined
            }
          />
          <Row
            label="Never touch"
            value={
              data.neverTouchServices.length > 0
                ? data.neverTouchServices.join(", ")
                : "no service is fenced off"
            }
            note="No autonomy level or policy can reach a service on this list."
          />
        </dl>
      )}
    </section>
  );
}
