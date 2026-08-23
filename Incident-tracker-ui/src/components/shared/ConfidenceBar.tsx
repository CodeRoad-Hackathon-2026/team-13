import { useOperator } from "../../state/OperatorContext";

interface ConfidenceBarProps {
  confidence: number;
}

// AR-2: bar + numeric value; below the threshold the card is visibly qualified.
// The design pairs a hairline meter with the value set in mono under a "CONFIDENCE" eyebrow.
// The meter's colour still tracks the low-confidence threshold rather than the risk level: risk
// already owns the chip, and AR-2's qualification is the signal this control exists to carry.
export function ConfidenceBar({ confidence }: ConfidenceBarProps) {
  const { lowConfidenceThreshold } = useOperator();
  const isLow = confidence < lowConfidenceThreshold;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="eyebrow">Confidence</span>
      <div className="flex items-center gap-2.5">
        <div
          role="img"
          aria-label={`AI confidence ${confidence.toFixed(2)}`}
          className="h-[6px] w-24 overflow-hidden rounded-full bg-border shadow-inner"
        >
          {/* Width is the datum, so it stays an inline style; only the hue is a class. */}
          <div
            style={{ width: `${confidence * 100}%` }}
            data-low={isLow}
            className="h-full rounded-full bg-ok transition-[width] duration-300 data-[low=true]:bg-warn"
          />
        </div>
        <span className="font-mono text-[15px] tabular-nums">{confidence.toFixed(2)}</span>
      </div>
      {isLow && (
        <p className="text-[11px] font-medium text-warn">Low confidence — review parameters.</p>
      )}
    </div>
  );
}
