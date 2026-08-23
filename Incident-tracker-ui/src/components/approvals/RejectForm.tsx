import { useForm } from "react-hook-form";
import type { RejectFormValues } from "../../domain/rejection";
import {
  ALERT_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_CONTROL,
  FIELD_LABEL,
} from "../shared/sectionStyles";

interface RejectFormProps {
  onSubmit: (values: RejectFormValues) => void;
  onCancel: () => void;
}

// FR-038/FR-039/AR-6: required reason, optional corrections. Does not call the API itself —
// ApprovalCard owns the mutation (component-inventory.md) and maps these values via
// domain/rejection.ts's toRejectRequest.
export function RejectForm({ onSubmit, onCancel }: RejectFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RejectFormValues>({ defaultValues: { reason: "", correctedCategory: "", correctedPriority: undefined } });

  return (
    <form onSubmit={handleSubmit((values) => onSubmit(values))} className="grid gap-3">
      <label className={FIELD_LABEL}>
        Reason <span aria-hidden="true" className="text-bad">*</span>
        <textarea
          rows={3}
          className={FIELD_CONTROL}
          {...register("reason", {
            validate: (value) => value.trim().length > 0 || "A reason is required",
          })}
        />
      </label>
      {errors.reason && (
        <p role="alert" className={ALERT_NOTE}>
          {errors.reason.message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
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
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="submit" className={BUTTON_PRIMARY}>
          Submit rejection
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
