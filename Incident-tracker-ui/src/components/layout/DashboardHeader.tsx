import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ENVIRONMENTS } from "../../api/types";
import { useUrlState } from "../../state/useUrlState";
import { useOperator } from "../../state/OperatorContext";
import { useServices } from "../../api/services";
import type { TimeRange } from "../../domain/filters";
import { User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TIME_RANGES: readonly TimeRange[] = ["24h", "7d", "30d", "all"];

const TIME_RANGE_TOOLTIP =
  "Time range applies to Performance and Knowledge. The alert strip and the Now tab always show current state, whatever range is selected.";

// The design's one control shape: a white box on a hairline border, generous horizontal padding,
// 10px radius. Every dropdown and button in the header is a variation on it.
const BOX =
  "h-9 rounded-[10px] border border-border bg-card px-3.5 text-[13px] text-foreground shadow-2xs transition-all hover:border-border hover:bg-muted/40 hover:shadow-xs";

// Native <select> keeps the browser's own keyboard and form semantics (and is what the header's
// tests drive); its own arrow is suppressed because the design's boxes carry no chevron.
// Geometry only — the surface comes from the Button variant.
const BUTTON_GEOMETRY = "h-9 rounded-[10px] bg-card px-3.5 text-[13px] font-medium";

function environmentLabel(environment: readonly string[]): string {
  if (environment.length === 0) return "All environments";
  if (environment.length === 1) return environment[0];
  return `${environment.length} environments`;
}

function LiveIndicator() {
  const [secondsAgo, setSecondsAgo] = useState(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    const interval = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const label = secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`;

  return (
    <div className="flex items-center gap-2.5">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="relative flex size-[6px] shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
          <span className="relative inline-flex size-full rounded-full bg-ok" />
        </span>
        <span className="meta">updated {label}</span>
      </span>
      <Button
        aria-label="Refresh"
        variant="outline"
        className={`${BUTTON_GEOMETRY} shadow-2xs`}
        onClick={() => {
          queryClient.invalidateQueries();
          setSecondsAgo(0);
        }}
      >
        Refresh
      </Button>
    </div>
  );
}

// FR-121: the operator can see and change the name attached to every action they take.
// The design leaves no room for a name plus a button, so identity collapses to one avatar-sized
// chip: initials at a glance, the full name and the change affordance one click away.
function initialsOf(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function OperatorNameControl() {
  const { operatorName, setOperatorName } = useOperator();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(operatorName ?? "");

  if (editing) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = draft.trim();
          if (trimmed) {
            setOperatorName(trimmed);
            setEditing(false);
          }
        }}
      >
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Your name
          <input
            autoFocus
            className={`${BOX} w-32`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <Button type="submit" className={BUTTON_GEOMETRY}>
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          className={`${BUTTON_GEOMETRY} text-muted-foreground`}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Operator: ${operatorName ?? "no name set"}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
        >
          {operatorName ? initialsOf(operatorName) : <User aria-hidden="true" className="size-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-muted-foreground">
          {operatorName ?? "No name set"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            setDraft(operatorName ?? "");
            setEditing(true);
          }}
        >
          {operatorName ? "Change name" : "Set name"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// FR-001..FR-004,FR-006: time range/env/service controls + the FR-004 tooltip explaining scope,
// live indicator + manual refresh.
export function DashboardHeader() {
  const { timeRange, setTimeRange, environment, setEnvironment, service, setService } =
    useUrlState();
  // Real `services.id` values: anything else is a 400 from every endpoint the
  // service filter feeds.
  const { data: serviceCatalogue } = useServices();

  return (
    <header className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-6 py-3.5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate text-[17px] font-semibold tracking-[-0.3px] text-foreground">
          Incident Response Orchestrator
        </h1>
        <span className="meta shrink-0 text-[11px] uppercase tracking-[0.12em]">Autonomous</span>
      </div>

      {/* The whole control cluster wraps as one unit, so a narrow window drops it to its own row
          rather than interleaving controls with the title. */}
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {/* Segmented control: the selected range is carried by aria-pressed, which also drives the
            white pill — the visual state cannot drift from what assistive tech is told. */}
        <div
          role="group"
          aria-label="Time range"
          // FR-004: the scope note lives on the control it describes rather than on a separate
          // "?" affordance the design has no room for.
          title={TIME_RANGE_TOOLTIP}
          data-tip={TIME_RANGE_TOOLTIP}
          className="flex items-center rounded-[10px] bg-muted p-1 shadow-inner"
        >
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              aria-pressed={timeRange === range}
              className="rounded-[7px] px-4 py-1.5 text-[13px] font-medium text-muted-foreground transition-all hover:text-foreground aria-pressed:bg-card aria-pressed:font-semibold aria-pressed:text-foreground aria-pressed:shadow-sm"
              onClick={() => setTimeRange(range)}
            >
              {range}
            </button>
          ))}
        </div>

        <span aria-hidden="true" className="h-5 w-px bg-border" />

        {/*
          FR-002 requires multi-select, which a native <select multiple> can only render as a
          multi-row listbox — the one shape the design has no room for. A checkbox menu keeps the
          multi-select contract behind the same single-line box as every other header control.
        */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Environment" className={`${BOX} w-[168px] text-left`}>
              {environmentLabel(environment)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[168px]">
            {ENVIRONMENTS.map((env) => (
              <DropdownMenuCheckboxItem
                key={env}
                checked={environment.includes(env)}
                onCheckedChange={(checked) =>
                  setEnvironment(
                    checked ? [...environment, env] : environment.filter((e) => e !== env),
                  )
                }
              >
                {env}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div>
          <select
            aria-label="Service"
            className={`${BOX} w-[168px] appearance-none`}
            value={service ?? "all"}
            onChange={(event) =>
              setService(event.target.value === "all" ? null : event.target.value)
            }
          >
            <option value="all">All services</option>
            {(serviceCatalogue?.services ?? []).map((svc) => (
              <option key={svc.id} value={svc.id}>
                {svc.name}
              </option>
            ))}
          </select>
        </div>

        <LiveIndicator />
        <OperatorNameControl />
      </div>
    </header>
  );
}
