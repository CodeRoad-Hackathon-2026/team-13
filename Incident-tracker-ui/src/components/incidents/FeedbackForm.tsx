import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSubmitFeedback } from "../../api/feedback";
import type { FeedbackRecord } from "../../api/feedback";
import type { FeedbackType, Priority } from "../../api/types";
import { useOperatorNameGate } from "../shared/useOperatorNameGate";
import {
  ALERT_NOTE,
  BUTTON_PRIMARY,
  FIELD_CONTROL,
  FIELD_LABEL,
  MUTED_NOTE,
  SECTION,
  SECTION_TITLE,
} from "../shared/sectionStyles";

interface FeedbackFormValues {
  feedbackType: FeedbackType | "";
  comments: string;
  correctedCategory?: string;
  correctedPriority?: Priority | "";
  correctedResolution?: string;
}

interface FeedbackFormProps {
  incidentId: string;
  existingFeedback: FeedbackRecord[];
}

// FR-073/PRD §D7: always-available, existing feedback listed above the form. Prepends the new
// row from the write response directly (contracts/feedback-endpoint.md) rather than refetching
// the whole drawer.
export function FeedbackForm({ incidentId, existingFeedback }: FeedbackFormProps) {
  const [feedback, setFeedback] = useState(existingFeedback);
  const { requireOperatorName, operatorNamePrompt } = useOperatorNameGate();
  const mutation = useSubmitFeedback(incidentId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FeedbackFormValues>({ defaultValues: { feedbackType: "", comments: "" } });

  function onSubmit(values: FeedbackFormValues) {
    if (!values.feedbackType) return;
    requireOperatorName((actor) => {
      mutation.mutate(
        {
          actor,
          feedbackType: values.feedbackType as FeedbackType,
          comments: values.comments,
          correctedCategory: values.correctedCategory || undefined,
          correctedPriority: (values.correctedPriority || undefined) as Priority | undefined,
          correctedResolution: values.correctedResolution || undefined,
        },
        {
          onSuccess: (newRecord) => {
            setFeedback((prev) => [newRecord, ...prev]);
            reset();
          },
        },
      );
    });
  }

  return (
    <section aria-label="Feedback" className={`${SECTION} shadow-xs`}>
      <h3 className={SECTION_TITLE}>Existing feedback</h3>
      {feedback.length === 0 ? (
        <p className={MUTED_NOTE}>No feedback submitted yet.</p>
      ) : (
        <ul className="grid gap-1.5">
          {feedback.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-baseline gap-2 rounded-md border border-border-soft bg-secondary px-2.5 py-1.5 text-[12.5px]"
            >
              <span className="rounded bg-muted px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {f.feedbackType}
              </span>
              <span>{f.comments}</span>
              <span className="ml-auto text-[11.5px] text-subtle-foreground">{f.createdBy}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-3 grid gap-2.5">
        <label className={FIELD_LABEL}>
          Feedback type
          <select
            className={FIELD_CONTROL}
            {...register("feedbackType", {
              validate: (value) => Boolean(value) || "Feedback type is required",
            })}
          >
            <option value="">Select…</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CORRECTED">Corrected</option>
          </select>
        </label>
        {errors.feedbackType && (
          <p role="alert" className={ALERT_NOTE}>
            {errors.feedbackType.message}
          </p>
        )}

        <label className={FIELD_LABEL}>
          Comments
          <textarea
            rows={3}
            className={FIELD_CONTROL}
            {...register("comments", {
              validate: (value) => value.trim().length > 0 || "Comments are required",
            })}
          />
        </label>
        {errors.comments && (
          <p role="alert" className={ALERT_NOTE}>
            {errors.comments.message}
          </p>
        )}

        <label className={FIELD_LABEL}>
          Corrected category (optional)
          <input type="text" className={FIELD_CONTROL} {...register("correctedCategory")} />
        </label>
        <label className={FIELD_LABEL}>
          Corrected priority (optional)
          <select className={FIELD_CONTROL} {...register("correctedPriority")}>
            <option value="">—</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
            <option value="P4">P4</option>
          </select>
        </label>
        <label className={FIELD_LABEL}>
          Corrected resolution (optional)
          <textarea rows={2} className={FIELD_CONTROL} {...register("correctedResolution")} />
        </label>

        <button type="submit" className={BUTTON_PRIMARY}>
          Submit feedback
        </button>
      </form>
      {operatorNamePrompt}
    </section>
  );
}
