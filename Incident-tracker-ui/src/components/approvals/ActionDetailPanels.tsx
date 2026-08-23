import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { PendingApprovalCard } from "../../api/approvals/pending";
import type { ActionType } from "../../api/types";
import { ParametersBlock } from "./ParametersBlock";
import { PreflightPanel } from "./PreflightPanel";
import { ProposedChange } from "./ProposedChange";
import { useProposedChange } from "./useProposedChange";

type PanelKey = "change" | "evidence" | "preflight";

interface ActionDetailPanelsProps {
  actionId: string;
  actionType: ActionType;
  matches: PendingApprovalCard["topMatches"];
}

// A disclosure group, not an ARIA tablist: FR-035 and FR-036 both require this detail to be
// collapsed until asked for, and a tablist always has one panel open. Each button therefore
// carries aria-expanded and controls its own panel, while reading as the design's segmented row.
const TAB_BASE =
  "rounded-[8px] px-3.5 py-1.5 text-[13px] font-medium transition-all aria-expanded:bg-card aria-expanded:text-foreground aria-expanded:shadow-sm";
const TAB_IDLE = "text-muted-foreground hover:text-foreground";
// The open panel is ringed rather than merely filled — with three lookalike controls in a row,
// fill alone reads as hover.
const TAB_OPEN = "aria-expanded:ring-1 aria-expanded:ring-p2";

// A panel the API cannot feed. Kept for the proposed-change case, where an action written by
// something other than the Decision Agent may carry no diff at all — the constitution forbids
// inventing response fields, so it states that plainly rather than rendering invented content.
function NotYetAvailable({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-[13px] font-medium text-muted-foreground">Not yet available</p>
      <p className="mt-1 text-[12.5px] text-subtle-foreground">{children}</p>
    </div>
  );
}

export function ActionDetailPanels({ actionId, actionType, matches }: ActionDetailPanelsProps) {
  const [open, setOpen] = useState<PanelKey | null>(null);
  const { change, isLoading: changeLoading } = useProposedChange(actionId, open === "change");

  function toggle(key: PanelKey) {
    setOpen((current) => (current === key ? null : key));
  }

  const tabs: ReadonlyArray<{ key: PanelKey; label: string; count?: string }> = [
    { key: "change", label: "Proposed change" },
    { key: "evidence", label: "Evidence", count: String(matches.length) },
    { key: "preflight", label: "Pre-flight" },
  ];

  const context: Record<PanelKey, string> = {
    change: change
      ? `${change.files.length} ${change.files.length === 1 ? "file" : "files"} · not yet merged`
      : "no diff on this action yet",
    evidence: `${matches.length} sources · highest match first`,
    preflight: "what would happen if you approved this",
  };

  return (
    <div className="border-t border-border-soft px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[10px] bg-muted p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-expanded={open === tab.key}
              aria-controls={`${actionId}-${tab.key}`}
              onClick={() => toggle(tab.key)}
              className={`${TAB_BASE} ${TAB_IDLE} ${TAB_OPEN}`}
            >
              {tab.label}
              {tab.count && (
                <span className="ml-1.5 font-mono text-[11.5px] opacity-60">{tab.count}</span>
              )}
            </button>
          ))}
        </div>
        {open && <span className="meta">{context[open]}</span>}
      </div>

      {open === "change" && (
        <div id={`${actionId}-change`} className="mt-3.5">
          {changeLoading && (
            <p className="text-[12.5px] text-muted-foreground">Loading the proposed change…</p>
          )}
          {!changeLoading && change && <ProposedChange change={change} />}
          {!changeLoading && !change && (
            <NotYetAvailable>
              This action changes no code — only actions the planner expressed as a patch carry one.
            </NotYetAvailable>
          )}
        </div>
      )}

      {open === "evidence" && (
        <div id={`${actionId}-evidence`} className="mt-3.5 grid gap-2">
          {/* AR-4: the matches that drove the recommendation, already on the card payload. */}
          {matches.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No similar incidents or runbooks matched.
            </p>
          ) : (
            matches.map((match, index) => (
              <div
                key={`${match.sourceUrl}-${index}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border px-3.5 py-2.5"
              >
                <span className="eyebrow w-[92px] shrink-0">{match.documentType}</span>
                <span className="min-w-0 flex-1 text-[13px]">{match.title}</span>
                <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                  {match.score.toFixed(2)}
                </span>
                <a
                  href={match.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12.5px] text-p3 hover:underline"
                >
                  View source
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                </a>
              </div>
            ))
          )}
          <ParametersBlock actionId={actionId} actionType={actionType} enabled />
        </div>
      )}

      {open === "preflight" && (
        <div id={`${actionId}-preflight`} className="mt-3.5">
          <PreflightPanel actionId={actionId} />
        </div>
      )}
    </div>
  );
}
