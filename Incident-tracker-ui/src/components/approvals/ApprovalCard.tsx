import { useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { PendingApprovalCard } from "../../api/approvals/pending";
import { useApproveAction } from "../../api/approvals/approve";
import { useRejectAction } from "../../api/approvals/reject";
import { useExecutionStatus } from "../../api/approvals/execution";
import { ApiError } from "../../api/client";
import { isStillRunning, formatElapsedMs, elapsedExecutionMs } from "../../domain/execution";
import { toRejectRequest, type RejectFormValues } from "../../domain/rejection";
import { RiskBadge } from "../shared/RiskBadge";
import { ConfidenceBar } from "../shared/ConfidenceBar";
import { OutcomeBadge } from "../shared/OutcomeBadge";
import { ActionDetailPanels } from "./ActionDetailPanels";
import { RejectForm } from "./RejectForm";
import { useApproveConfirmGate } from "./useApproveConfirmGate";
import { useOperatorNameGate } from "../shared/useOperatorNameGate";
import { ageMinutes, formatAge } from "../../domain/age";
import { systemClock } from "../../domain/clock";

type CardPhase =
  "proposed" | "executing" | "showing-reject-form" | "submitting-reject" | "rejected";

interface ApprovalCardProps {
  card: PendingApprovalCard;
  // Called once the reject mutation is confirmed by the server — lets a list-owning parent
  // (ApprovalQueue) drop this specific card from its own local view. Optional: this card still
  // shows its own terminal "Rejected" state regardless, for callers with no list to update.
  onRejected?: () => void;
}

// FR-033-045, §11.19: owns its own approve/reject mutations, keyed by this card's own action id —
// never by array index — so a sibling card's resolution or removal can never disturb this one.
export function ApprovalCard({ card, onRejected }: ApprovalCardProps) {
  const [phase, setPhase] = useState<CardPhase>("proposed");
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const hasClickedApprove = useRef(false);

  const approveMutation = useApproveAction(card.id);
  const rejectMutation = useRejectAction(card.id);
  const { requestApprove, confirmModal } = useApproveConfirmGate(card.description);
  const { requireOperatorName, operatorNamePrompt } = useOperatorNameGate();
  // Gated on the approve mutation's own success, not just the optimistic phase flip, so this
  // never races the real backend's ExecutedAction record into existence before it's created.
  const executionQuery = useExecutionStatus(
    card.id,
    phase === "executing" && approveMutation.isSuccess,
  );
  const execution = executionQuery.data;

  // Structurally-identical poll responses (still RUNNING, same startedAt) don't change `execution`
  // by reference, so nothing would otherwise force a re-render — the elapsed time and the
  // still-running switch are computed fresh at render time, and need one every second regardless
  // of whether the last poll actually returned new data.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (phase !== "executing" || execution?.status !== "RUNNING") return;
    const interval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [phase, execution?.status]);

  function performApprove(actor: string) {
    // FR-044/X-4: the synchronous ref guard is the real idempotency boundary — it blocks a second
    // mutate() call even from two clicks in the same event-loop tick, before any re-render.
    if (hasClickedApprove.current) return;
    hasClickedApprove.current = true;
    setApproveError(null);
    setPhase("executing"); // FR-045: applied optimistically, ahead of server confirmation.

    approveMutation.mutate(
      { actor, ...(card.riskLevel === "HIGH" ? { confirmedHighRisk: true as const } : {}) },
      {
        onError: (error) => {
          hasClickedApprove.current = false;
          setPhase("proposed");
          setApproveError(
            error instanceof ApiError ? error.message : "Could not approve this action.",
          );
        },
      },
    );
  }

  function handleApproveClick() {
    requireOperatorName((actor) => requestApprove(card.riskLevel, () => performApprove(actor)));
  }

  function performReject(actor: string, values: RejectFormValues) {
    setRejectError(null);
    setPhase("submitting-reject");

    rejectMutation.mutate(toRejectRequest(values, actor), {
      onSuccess: () => {
        setPhase("rejected");
        onRejected?.();
      },
      onError: (error) => {
        setPhase("showing-reject-form");
        setRejectError(error instanceof ApiError ? error.message : "Could not reject this action.");
      },
    });
  }

  return (
    // §11.19: keyed by this card's own action id upstream, and every phase below is local state.
    // Risk colour concentrates in the RiskBadge and the confidence meter — the card shell stays a
    // neutral border so the chip, not a decorative stripe, is what reads as risk.
    <li
      data-phase={phase}
      data-risk={card.riskLevel}
      data-action-id={card.id}
      className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:shadow-md data-[phase=executing]:border-p3/40 data-[phase=executing]:shadow-[0_0_0_1px_rgb(37_99_235/0.15),var(--shadow-md)] data-[phase=rejected]:opacity-60 data-[phase=rejected]:shadow-none data-[phase=rejected]:hover:shadow-none"
    >
      <div className="flex items-start justify-between gap-5 p-4 pt-[18px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <RiskBadge risk={card.riskLevel} />
            <span className="meta">
              {card.serviceName} · {card.priority} ·{" "}
              {formatAge(ageMinutes(card.proposedAt, systemClock))}
            </span>
          </div>
          <h3 className="mt-2.5 text-[17px] font-semibold leading-snug tracking-[-0.2px] text-balance text-foreground">
            {card.description}
          </h3>
          <p className="mt-1 truncate text-[13px] text-muted-foreground">{card.incidentTitle}</p>
        </div>
        <div className="shrink-0 rounded-lg bg-muted/70 px-3.5 py-2.5">
          <ConfidenceBar confidence={card.confidenceScore} />
        </div>
      </div>

      <ActionDetailPanels
        actionId={card.id}
        actionType={card.actionType}
        matches={card.topMatches}
      />

      {phase === "proposed" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft bg-muted/40 px-4 py-3">
          <span className="meta">proposed by {card.proposedByAgent}</span>
          <div className="flex items-center gap-2">
            {approveError && (
              <p role="alert" className="text-[12.5px] font-medium text-bad">
                {approveError}
              </p>
            )}
            {/* Reject stays the quiet control and Approve the committed one — X-4's confirm gate
                sits behind Approve, so it should never be the easier button to hit by accident. */}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground shadow-2xs transition-all hover:border-bad/30 hover:bg-chip-bad-bg hover:text-bad active:scale-[0.98]"
              onClick={() => setPhase("showing-reject-form")}
            >
              <X aria-hidden="true" className="size-3.5" />
              Reject
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary-hover hover:shadow-md active:scale-[0.98]"
              onClick={handleApproveClick}
            >
              <Check aria-hidden="true" className="size-3.5" />
              Approve
            </button>
          </div>
        </div>
      )}

      {phase === "showing-reject-form" && (
        <div className="border-t border-border-soft bg-muted/40 p-4">
          <RejectForm
            onSubmit={(values) => requireOperatorName((actor) => performReject(actor, values))}
            onCancel={() => setPhase("proposed")}
          />
          {rejectError && (
            <p role="alert" className="mt-2 text-[12.5px] font-medium text-bad">
              {rejectError}
            </p>
          )}
        </div>
      )}

      {phase === "submitting-reject" && (
        <p className="flex items-center gap-2 border-t border-border-soft px-4 py-3 text-[13px] text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          Submitting rejection…
        </p>
      )}
      {phase === "rejected" && (
        <p
          data-status="REJECTED"
          className="flex items-center gap-1.5 border-t border-border-soft px-4 py-3 text-[13px] font-semibold text-muted-foreground"
        >
          <X aria-hidden="true" className="size-3.5" />
          Rejected
        </p>
      )}

      {phase === "executing" && (
        <div className="grid gap-2 border-t border-border-soft bg-chip-info-bg/40 p-4">
          {!execution && (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-p3" />
              Submitting approval…
            </p>
          )}
          {execution && execution.status === "RUNNING" && isStillRunning(execution.startedAt) && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-warn">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                Still running · {formatElapsedMs(elapsedExecutionMs(execution.startedAt))}
              </p>
              <button
                type="button"
                className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-2xs transition-colors hover:text-foreground"
                onClick={() => executionQuery.refetch()}
              >
                Check now
              </button>
            </div>
          )}
          {execution && execution.status === "RUNNING" && !isStillRunning(execution.startedAt) && (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-p3" />
              Executing · {formatElapsedMs(elapsedExecutionMs(execution.startedAt))}
            </p>
          )}
          {execution && execution.status !== "RUNNING" && (
            <div className="grid gap-1.5">
              <OutcomeBadge status={execution.status} />
              {execution.errorMessage && (
                <p role="alert" className="text-[12.5px] text-bad">
                  {execution.errorMessage}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {confirmModal}
      {operatorNamePrompt}
    </li>
  );
}
