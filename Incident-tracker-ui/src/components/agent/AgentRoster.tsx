import type { AgentSummary, InvokedBy, RosterData } from "../../api/agents/roster";
import { useUpdateAgent } from "../../api/agents/mutations";
import { ApiError } from "../../api/client";
import { useState } from "react";
import { CardHeader } from "../shared/CardHeader";
import { SECTION } from "../shared/sectionStyles";
import { ToggleSwitch } from "../shared/ToggleSwitch";

interface AgentRosterProps {
  roster: RosterData;
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}

// What invokes each agent, in the operator's words. "nothing" is the interesting
// one and gets said plainly: eight registered agents are not eight running
// agents, and the dashboard has never shown the difference.
const INVOKED_LABEL: Record<InvokedBy, string> = {
  ingest: "on ingest",
  pipeline: "in the pipeline",
  approval: "on approval",
  nothing: "not called",
  unknown: "unknown",
};

const AUTONOMY_LABEL: Record<string, string> = {
  observe: "Observe",
  suggest: "Suggest",
  act_with_approval: "Act with approval",
  act_autonomously: "Act autonomously",
};

function AgentRow({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  // Optimistic, with a visible rollback. A switch that snaps back with no
  // explanation is worse than one that errors, because the operator is left
  // believing the opposite of what the server stored.
  const [active, setActive] = useState(agent.isActive);
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdateAgent(agent.id);

  function toggle(next: boolean) {
    setError(null);
    setActive(next);
    mutation.mutate(
      { isActive: next },
      {
        onError: (err) => {
          setActive(!next);
          setError(err instanceof ApiError ? err.message : "Could not change this agent.");
        },
      },
    );
  }

  const unreachable = agent.invokedBy === "nothing" || !agent.hasModule;

  return (
    <li className="border-t border-border-soft first:border-t-0">
      <div className="flex items-start gap-3 py-3">
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="-mx-2 min-w-0 flex-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/60 aria-[current]:bg-accent"
        >
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[13.5px] font-medium text-foreground">{agent.name}</span>
            <span className="meta text-[11px]">v{agent.version}</span>
            {/* Not a badge with a colour and no words: the fact that nothing calls
                this agent is the finding, so it is written out. */}
            {unreachable && (
              <span className="rounded bg-muted px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.06em] text-warn">
                {agent.hasModule ? "not called" : "no module"}
              </span>
            )}
          </span>
          {/* Interpuncts, not spacing. Four metadata phrases separated only by a
              gap read as one run-on sentence: "in the pipeline 13 runs 100% ok
              act with approval". */}
          <span className="meta mt-0.5 block text-[12px]">
            {[
              // Omitted when the badge above already says it — "not called"
              // twice on one row reads as two different facts.
              unreachable ? null : INVOKED_LABEL[agent.invokedBy],
              `${agent.runs.total} ${agent.runs.total === 1 ? "run" : "runs"}`,
              agent.runs.successRatePercent !== null
                ? `${agent.runs.successRatePercent}% ok`
                : null,
              AUTONOMY_LABEL[agent.autonomy] ?? agent.autonomy,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </span>
        </button>
        <span className="shrink-0 pt-1">
          <ToggleSwitch
            label={`${agent.name} enabled`}
            checked={active}
            onChange={toggle}
            showStateText={false}
          />
        </span>
      </div>
      {error && (
        <p role="alert" className="pb-2 text-[12.5px] font-medium text-bad">
          {error}
        </p>
      )}
    </li>
  );
}

// The roster the demo has never shown. Switching one off is not cosmetic:
// app/agents/registry.py selects `WHERE name = $1 AND is_active`, so a disabled
// agent refuses to run.
export function AgentRoster({ roster, selectedId, onSelect }: AgentRosterProps) {
  const running = roster.agents.filter((a) => a.invokedBy !== "nothing" && a.hasModule).length;

  return (
    <section aria-label="Agents" className={`${SECTION} shadow-xs`}>
      <CardHeader
        title="Agents"
        meta={`${running} of ${roster.agents.length} reachable`}
      />
      <ol>
        {roster.agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            onSelect={() => onSelect(agent.id)}
          />
        ))}
      </ol>
      <p className="mt-3 border-t border-border-soft pt-3 text-[12.5px] text-muted-foreground">
        Switching an agent off stops it running — the registry refuses to open a run
        for it. "Not called" means the module exists but nothing invokes it yet.
      </p>
    </section>
  );
}
