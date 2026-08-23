import { useForm } from "react-hook-form";
import { useActionTypes } from "../../api/agents/skills";
import type { SkillPayload } from "../../api/agents/skills";
import type { AgentSkill } from "../../api/agents/roster";
import { useServices } from "../../api/services";
import { ENVIRONMENTS } from "../../api/types";
import type { RiskLevel } from "../../api/types";
import {
  ALERT_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_CONTROL,
  FIELD_LABEL,
} from "../shared/sectionStyles";

interface SkillFormProps {
  // Present when editing. One component for both, because a create form and an
  // edit form that disagree is how they drift apart.
  skill?: AgentSkill;
  onSubmit: (payload: SkillPayload) => void;
  onCancel: () => void;
  onDelete?: () => void;
  pending?: boolean;
  error?: string | null;
}

interface SkillFormValues {
  name: string;
  description: string;
  actionType: string;
  riskLevel: RiskLevel;
  serviceId: string;
  environments: string[];
}

export function SkillForm({
  skill,
  onSubmit,
  onCancel,
  onDelete,
  pending = false,
  error,
}: SkillFormProps) {
  const actionTypes = useActionTypes();
  const services = useServices();
  const optionsReady = Boolean(actionTypes.data) && Boolean(services.data);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SkillFormValues>({
    defaultValues: {
      name: skill?.name ?? "",
      description: skill?.description ?? "",
      actionType: skill?.actionType ?? "",
      riskLevel: skill?.riskLevel ?? "MEDIUM",
      serviceId: skill?.serviceId ?? "",
      environments: skill?.environments ?? [],
    },
  });

  const chosenType = watch("actionType");
  const chosen = actionTypes.data?.actionTypes.find((t) => t.actionType === chosenType);

  function submit(values: SkillFormValues) {
    onSubmit({
      name: values.name.trim(),
      description: values.description.trim() || null,
      actionType: values.actionType,
      riskLevel: values.riskLevel,
      environments: values.environments,
      // Always sent, because the server distinguishes an omitted field from an
      // explicit null and clearing the service is a thing this form can do.
      serviceId: values.serviceId || null,
    });
  }

  // Nothing is rendered until both option lists have arrived, and the key below
  // is what makes that safe. react-hook-form reads defaultValues once, on the
  // first render — so a <select> whose chosen <option> does not exist yet falls
  // back to "", and the form would then save an empty serviceId over a real one.
  // Editing a skill's name would silently unbind it from its service.
  if (!optionsReady) {
    return (
      <p className="text-[13px] text-muted-foreground" role="status">
        Loading the action types and services this skill can use…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-3">
      <label className={FIELD_LABEL}>
        {/* One span, because FIELD_LABEL is a grid: a bare text node and a
            sibling span become two rows, and the asterisk lands under the word. */}
        <span>
          Name <span aria-hidden="true" className="text-bad">*</span>
        </span>
        <input
          className={FIELD_CONTROL}
          aria-invalid={errors.name ? "true" : undefined}
          aria-describedby={errors.name ? "skill-name-error" : undefined}
          {...register("name", {
            validate: (value) => value.trim().length > 0 || "A name is required",
          })}
        />
      </label>
      {errors.name && (
        <p id="skill-name-error" role="alert" className={ALERT_NOTE}>
          {errors.name.message}
        </p>
      )}

      <label className={FIELD_LABEL}>
        What it does (optional)
        <textarea rows={2} className={FIELD_CONTROL} {...register("description")} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={FIELD_LABEL}>
          <span>
            Action type <span aria-hidden="true" className="text-bad">*</span>
          </span>
          <select
            className={FIELD_CONTROL}
            aria-invalid={errors.actionType ? "true" : undefined}
            aria-describedby={errors.actionType ? "skill-type-error" : undefined}
            {...register("actionType", {
              validate: (value) => Boolean(value) || "An action type is required",
            })}
          >
            <option value="">Select…</option>
            {(actionTypes.data?.actionTypes ?? []).map((type) => (
              <option key={type.actionType} value={type.actionType}>
                {type.actionType}
                {/* The fact is in the option itself, so it is visible before the
                    choice rather than only after it. */}
                {!type.hasExecutor && " — no executor"}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD_LABEL}>
          Risk
          <select className={FIELD_CONTROL} {...register("riskLevel")}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </label>
      </div>
      {errors.actionType && (
        <p id="skill-type-error" role="alert" className={ALERT_NOTE}>
          {errors.actionType.message}
        </p>
      )}

      {/* Not an error — the skill is allowed, and may be registered deliberately
          just before its executor. But an operator who reads this now does not
          have to discover it from a failed approval later, which is where
          Pre-flight otherwise says the same sentence. */}
      {chosen && !chosen.hasExecutor && (
        <p className="rounded-lg border border-warn/30 bg-chip-warn-bg px-3 py-2 text-[12.5px] text-warn">
          Nothing is registered to carry out a {chosen.actionType} action. This skill
          can be proposed, and approving it would fail immediately without
          attempting anything.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className={FIELD_LABEL}>
          Service (optional)
          <select className={FIELD_CONTROL} {...register("serviceId")}>
            <option value="">Any service</option>
            {(services.data?.services ?? []).map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>

        {/* Checkboxes, not a text field: there are exactly three values an
            incident can carry, and a typed one would silently never match. */}
        <fieldset className="grid gap-1.5">
          <legend className="text-[13px] font-medium text-muted-foreground">
            Environments (optional)
          </legend>
          {ENVIRONMENTS.map((environment) => (
            <label
              key={environment}
              className="flex items-center gap-2 text-[13px] text-foreground"
            >
              <input type="checkbox" value={environment} {...register("environments")} />
              {environment}
            </label>
          ))}
        </fieldset>
      </div>

      {error && (
        <p role="alert" className={ALERT_NOTE}>
          {error}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {pending ? "Saving…" : skill ? "Save changes" : "Add skill"}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto rounded-lg px-3 py-1.5 text-[13px] font-medium text-bad transition-colors hover:bg-chip-bad-bg"
          >
            Remove skill
          </button>
        )}
      </div>
    </form>
  );
}
