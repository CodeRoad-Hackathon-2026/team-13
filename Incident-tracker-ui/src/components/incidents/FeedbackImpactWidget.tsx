import { useFeedbackImpact } from "../../api/feedbackImpact";
import { useOperator } from "../../state/OperatorContext";
import { RelativeTime } from "../shared/RelativeTime";
import { METER_TRACK } from "../shared/sectionStyles";

// FI-1..FI-5/FR-074-079/§11.20: the one motivational pattern in this product. Deliberately does
// NOT follow Principle VII's usual four states — FI-4 explicitly demands invisibility, not a
// caveated loading/error/empty state, whenever there's nothing meaningful (or too little) to show,
// so this returns null for every non-happy path rather than rendering a skeleton or error box for
// content that's non-critical and might end up suppressed anyway.
export function FeedbackImpactWidget() {
  const { operatorName } = useOperator();
  const { data, isLoading, isError } = useFeedbackImpact(operatorName);

  if (!operatorName || isLoading || isError || !data || data.suppressed) return null;

  const isDecline = data.personal.accuracyPercent < data.personal.previousAccuracyPercent;

  return (
    // FI-5/§13: encouraging, never competitive — no rank, no streak, no badge.
    <div
      aria-label="Feedback impact"
      className="grid gap-2 rounded-lg border border-ok/20 bg-chip-ok-bg p-3.5 shadow-xs"
    >
      <p className="text-[12.5px] font-semibold text-ok">
        Your corrections are training the classifier
      </p>
      <p className="text-[13px]">
        <strong className="text-[20px] font-semibold tracking-[-0.5px]">
          {data.personal.accuracyPercent}%
        </strong>{" "}
        classification accuracy, {isDecline ? "down from" : "up from"}{" "}
        {data.personal.previousAccuracyPercent}%
      </p>
      <div
        role="img"
        aria-label={`${data.personal.accuracyPercent}% classification accuracy`}
        className={`${METER_TRACK} bg-white`}
      >
        <div
          style={{ width: `${data.personal.accuracyPercent}%` }}
          className="h-full rounded-full bg-ok"
        />
      </div>
      {isDecline && (
        // FI-3/FR-078: never the user's failure — attributed to the model or the period, always.
        <p className="text-[12px] text-muted-foreground">
          This reflects the model or this period, not your feedback.
        </p>
      )}
      <p className="text-[12px] text-muted-foreground">
        {data.personal.correctionCount} corrections submitted
        {data.personal.lastCorrectionAt && (
          <>
            {" "}
            · last one <RelativeTime timestamp={data.personal.lastCorrectionAt} />
          </>
        )}
      </p>
      <p className="text-[12px] text-muted-foreground">
        Team total: {data.team.correctionCount} corrections this quarter across{" "}
        {data.team.engineerCount} engineers.
      </p>
    </div>
  );
}
