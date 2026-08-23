import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { fetchActionParameters, fetchExecutionDetail } from "../../api/incidents/detail";
import type { IncidentDetail } from "../../api/incidents/detail";
import type { PendingApprovalCard } from "../../api/approvals/pending";
import { ConfidenceBar } from "../shared/ConfidenceBar";
import { RiskBadge } from "../shared/RiskBadge";
import { OutcomeBadge } from "../shared/OutcomeBadge";
import { ApprovalCard } from "../approvals/ApprovalCard";
import {
  ALERT_NOTE,
  CODE_BLOCK,
  DISCLOSURE,
  MUTED_NOTE,
  SECTION,
  SECTION_TITLE,
} from "../shared/sectionStyles";

interface ActionsAndExecutionsProps {
  actions: IncidentDetail["actions"];
  incident: IncidentDetail["incident"];
  similarityMatches: IncidentDetail["similarityMatches"];
}

const TOP_MATCHES_CAP = 3;

/** The compare URL an execution reports, when it reported one. */
function compareUrlOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const url = (payload as { compareUrl?: unknown }).compareUrl;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

// FR-068: a still-PROPOSED action found here gets the exact same approve/reject behaviour as the
// queue (component-inventory.md) — built from data already loaded for this drawer, no new fetch.
function toPendingApprovalCard(
  action: IncidentDetail["actions"][number],
  incident: IncidentDetail["incident"],
  similarityMatches: IncidentDetail["similarityMatches"],
): PendingApprovalCard {
  return {
    id: action.id,
    incidentId: incident.id,
    incidentExternalId: incident.externalId,
    priority: incident.priority,
    serviceName: incident.serviceName,
    environment: incident.environment,
    incidentTitle: incident.title,
    actionType: action.actionType,
    description: action.description,
    riskLevel: action.riskLevel,
    confidenceScore: action.confidenceScore,
    topMatches: [...similarityMatches]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_MATCHES_CAP)
      .map((m) => ({
        documentType: m.documentType,
        title: m.title,
        score: m.score,
        sourceUrl: m.sourceUrl,
      })),
    proposedAt: incident.createdAt,
    // The detail response carries no link from an action back to the run that proposed it, so
    // this is a literal. It has to stay identical to what the queue renders — that one comes
    // from agents.name — or the same action reads as two different agents.
    proposedByAgent: "Decision Agent",
  };
}

function durationLabel(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "in progress";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function ExecutionEntry({
  execution,
}: {
  execution: NonNullable<IncidentDetail["actions"][number]["execution"]>;
}) {
  const [expanded, setExpanded] = useState(false);
  // P-4: response payload + execution logs are JSONB, fetched only once this execution is expanded.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["executions", execution.id, "detail"],
    queryFn: () => fetchExecutionDetail(execution.id),
    enabled: expanded,
  });

  return (
    <div className="mt-2 grid gap-2 rounded-md border border-border-soft bg-secondary p-2.5 shadow-2xs">
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeBadge status={execution.status} />
        <span className="font-mono text-[11.5px] text-subtle-foreground">
          {durationLabel(execution.startedAt, execution.finishedAt)}
        </span>
      </div>
      {execution.errorMessage && (
        <p role="alert" className={ALERT_NOTE}>
          {execution.errorMessage}
        </p>
      )}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className={DISCLOSURE}
      >
        <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
        Execution details
      </button>
      {expanded && (
        <div className="grid gap-2">
          {isLoading && <p className={MUTED_NOTE}>Loading execution details…</p>}
          {isError && (
            <p role="alert" className={ALERT_NOTE}>
              Could not load execution details.
            </p>
          )}
          {data && (
            <>
              {/* The delivery agent pushes a branch and returns the page that
                  opens a PR pre-filled. Buried in the JSON it is not "one
                  click", so it gets lifted out. */}
              {compareUrlOf(data.responsePayload) && (
                <a
                  href={compareUrlOf(data.responsePayload)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-p3 hover:bg-muted"
                >
                  Open pull request
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                </a>
              )}
              <pre className={CODE_BLOCK}>{JSON.stringify(data.responsePayload, null, 2)}</pre>
              <pre className={CODE_BLOCK}>{data.executionLogs}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ActionEntry({ action }: { action: IncidentDetail["actions"][number] }) {
  const [showParams, setShowParams] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["actions", action.id, "parameters"],
    queryFn: () => fetchActionParameters(action.id),
    enabled: showParams,
  });

  return (
    <li className="grid gap-2 rounded-lg border border-border bg-card p-3 shadow-2xs transition-shadow hover:shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-px font-mono text-[10.5px] font-semibold uppercase text-muted-foreground">
          {action.actionType}
        </span>
        <RiskBadge risk={action.riskLevel} />
        {/* AR-1/A11Y-1: the status is its own text, never inferred from the badge colour. */}
        <span
          data-status={action.status}
          className="ml-auto text-[11px] font-semibold uppercase tracking-wide text-muted-foreground data-[status=REJECTED]:text-bad data-[status=APPROVED]:text-ok"
        >
          {action.status}
        </span>
      </div>
      <p className="text-[13px] font-medium">{action.description}</p>
      <ConfidenceBar confidence={action.confidenceScore} />
      {action.approvedBy && (
        <span className="text-[11.5px] text-subtle-foreground">
          Approved by {action.approvedBy} at {action.approvedAt}
        </span>
      )}
      <button
        type="button"
        onClick={() => setShowParams((value) => !value)}
        aria-expanded={showParams}
        className={DISCLOSURE}
      >
        <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
        Parameters
      </button>
      {showParams && (
        <div className="grid gap-2">
          {isLoading && <p className={MUTED_NOTE}>Loading parameters…</p>}
          {isError && (
            <p role="alert" className={ALERT_NOTE}>
              Could not load parameters.
            </p>
          )}
          {data && <pre className={CODE_BLOCK}>{JSON.stringify(data.parameters, null, 2)}</pre>}
        </div>
      )}
      {action.execution && <ExecutionEntry execution={action.execution} />}
    </li>
  );
}

// FR-067/FR-068: recommended actions with executions nested underneath. A still-PROPOSED action
// reuses ApprovalCard wholesale; everything else (APPROVED/REJECTED, with its execution) stays the
// plain read-only view.
export function ActionsAndExecutions({
  actions,
  incident,
  similarityMatches,
}: ActionsAndExecutionsProps) {
  if (actions.length === 0) {
    return (
      <p className={`${SECTION} ${MUTED_NOTE} shadow-xs`}>
        No recommended actions for this incident.
      </p>
    );
  }

  return (
    <section aria-label="Recommended actions" className={`${SECTION} shadow-xs`}>
      <h3 className={SECTION_TITLE}>Recommended actions</h3>
      <ul className="grid gap-2">
        {actions.map((action) =>
          action.status === "PROPOSED" ? (
            <ApprovalCard
              key={action.id}
              card={toPendingApprovalCard(action, incident, similarityMatches)}
            />
          ) : (
            <ActionEntry key={action.id} action={action} />
          ),
        )}
      </ul>
    </section>
  );
}
