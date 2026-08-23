import type { IncidentDetail } from "../../api/incidents/detail";
import { EYEBROW, SECTION, SECTION_TITLE } from "../shared/sectionStyles";

interface ClassificationPanelProps {
  detail: IncidentDetail;
}

// PRD §D2/FR-063: shows the AI's classification, and "AI said X → human corrected to Y"
// side-by-side whenever a correction exists — surfacing corrections is how trust is earned.
export function ClassificationPanel({ detail }: ClassificationPanelProps) {
  const { aiClassification, correction } = detail;

  return (
    <section aria-label="AI classification" className={`${SECTION} shadow-xs`}>
      <h3 className={SECTION_TITLE}>AI classification</h3>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 text-[13px]">
        <div className="contents">
          <span className={EYEBROW}>Category</span>
          <span>{aiClassification.category}</span>
        </div>
        <div className="contents">
          <span className={EYEBROW}>Priority</span>
          {correction?.correctedPriority ? (
            <span>
              <span data-was="true" className="text-subtle-foreground line-through">
                {aiClassification.priority}
              </span>{" "}
              → <span className="font-semibold">{correction.correctedPriority}</span>
            </span>
          ) : (
            <span>{aiClassification.priority}</span>
          )}
        </div>
        <div className="contents">
          <span className={EYEBROW}>Confidence</span>
          <span className="font-mono text-[13px] tabular-nums">
            {aiClassification.confidenceScore != null
              ? aiClassification.confidenceScore.toFixed(2)
              : "—"}
          </span>
        </div>
        {correction?.correctedCategory && (
          <div className="contents">
            <span className={EYEBROW}>Category correction</span>
            <span>
              <span data-was="true" className="text-subtle-foreground line-through">
                {aiClassification.category}
              </span>{" "}
              → <span className="font-semibold">{correction.correctedCategory}</span>
            </span>
          </div>
        )}
      </dl>
    </section>
  );
}
