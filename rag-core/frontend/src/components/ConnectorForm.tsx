import { useMemo, useState } from "react";
import type { ConnectorField, ConnectorSpec, Secret } from "../api/types";

/**
 * A form rendered from the connector's own field schema.
 *
 * Nothing here knows what Slack or Jira need — `GET /v1/source-types` does.
 * That is deliberate: hardcoding one form per connector means every new
 * connector is a backend change *and* a frontend change, and the two drift the
 * first time a field is renamed.
 */

export type ConfigValue = unknown;
export type Config = Record<string, ConfigValue>;

/** Split a comma/newline separated string into a list, dropping blanks. */
function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderList(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

function parseKeyValue(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    if (key) out[key] = line.slice(index + 1).trim();
  }
  return out;
}

function renderKeyValue(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}

function SecretInput({
  field,
  value,
  secrets,
  vaultEnabled,
  onChange,
}: {
  field: ConnectorField;
  value: string;
  secrets: Secret[];
  vaultEnabled: boolean;
  onChange: (next: string) => void;
}) {
  // A secret field holds a *reference*, never a credential. Offering the
  // stored names as a picker is what keeps a token from being pasted into a
  // config that GET /v1/sources hands to every reader.
  const referenced = /^\$\{([A-Z][A-Z0-9_]*)\}$/.exec(value)?.[1];
  return (
    <div>
      <div className="row">
        <select
          value={referenced && secrets.some((s) => s.name === referenced) ? referenced : ""}
          onChange={(e) => onChange(e.target.value ? `\${${e.target.value}}` : "")}
          style={{ flex: 1 }}
        >
          <option value="">
            {secrets.length ? "— pick a stored secret —" : "— no secrets stored —"}
          </option>
          {secrets.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} (…{s.hint})
            </option>
          ))}
        </select>
        <input
          style={{ flex: 1 }}
          placeholder={field.placeholder || "${SOME_TOKEN}"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <p className="muted small" style={{ marginTop: 4 }}>
        {vaultEnabled
          ? "Stores a ${NAME} reference. Add the value in the Secrets tab — it is encrypted and never returned by the API."
          : "SECRETS_KEY is not set, so the vault is off. ${NAME} resolves from the worker environment instead."}
      </p>
    </div>
  );
}

function FieldInput({
  field,
  value,
  secrets,
  vaultEnabled,
  onChange,
}: {
  field: ConnectorField;
  value: unknown;
  secrets: Secret[];
  vaultEnabled: boolean;
  onChange: (next: unknown) => void;
}) {
  switch (field.type) {
    case "secret":
      return (
        <SecretInput
          field={field}
          value={typeof value === "string" ? value : ""}
          secrets={secrets}
          vaultEnabled={vaultEnabled}
          onChange={onChange}
        />
      );
    case "number":
      return (
        <input
          type="number"
          placeholder={String(field.default ?? "")}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );
    case "boolean":
      return (
        <label className="row small">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          enabled
        </label>
      );
    case "select":
      return (
        <select
          value={typeof value === "string" ? value : String(field.default ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "textarea":
      return (
        <textarea
          rows={3}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case "list":
      return (
        <input
          placeholder={field.placeholder || renderList(field.default) || "a, b, c"}
          value={renderList(value)}
          onChange={(e) => {
            const parsed = parseList(e.target.value);
            onChange(parsed.length ? parsed : undefined);
          }}
        />
      );
    case "keyvalue":
      return (
        <textarea
          rows={3}
          placeholder={field.placeholder || "key = value"}
          value={renderKeyValue(value)}
          onChange={(e) => {
            const parsed = parseKeyValue(e.target.value);
            onChange(Object.keys(parsed).length ? parsed : undefined);
          }}
        />
      );
    default:
      return (
        <input
          placeholder={field.placeholder || String(field.default ?? "")}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
  }
}

export function ConnectorForm({
  spec,
  config,
  secrets,
  vaultEnabled,
  onChange,
}: {
  spec: ConnectorSpec;
  config: Config;
  secrets: Secret[];
  vaultEnabled: boolean;
  onChange: (next: Config) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [basic, advanced] = useMemo(
    () => [
      spec.fields.filter((f) => !f.advanced),
      spec.fields.filter((f) => f.advanced),
    ],
    [spec],
  );

  const set = (name: string, value: unknown) => {
    const next = { ...config };
    // Deleting rather than storing undefined keeps the saved config to what
    // was actually set — otherwise every optional key is persisted as null and
    // the connector cannot tell "unset" from "explicitly empty".
    if (value === undefined || value === "") delete next[name];
    else next[name] = value;
    onChange(next);
  };

  const render = (field: ConnectorField) => (
    <div key={field.name} className="field">
      <label>
        {field.label}
        {field.required && <span className="req"> *</span>}
        <code className="muted small"> {field.name}</code>
      </label>
      <FieldInput
        field={field}
        value={config[field.name]}
        secrets={secrets}
        vaultEnabled={vaultEnabled}
        onChange={(v) => set(field.name, v)}
      />
      {field.help && field.type !== "secret" && (
        <p className="muted small">{field.help}</p>
      )}
    </div>
  );

  return (
    <div>
      {basic.map(render)}
      {advanced.length > 0 && (
        <>
          <button
            className="small"
            style={{ marginTop: 8 }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide" : "Show"} {advanced.length} advanced field
            {advanced.length === 1 ? "" : "s"}
          </button>
          {showAdvanced && <div style={{ marginTop: 10 }}>{advanced.map(render)}</div>}
        </>
      )}
    </div>
  );
}
