import { useCallback, useEffect, useState } from "react";
import { api, getApiKey } from "../api/client";
import type {
  Collection,
  ConnectorSpec,
  Prompt,
  PromptVersion,
  Secret,
  Source,
  SourceRun,
  SourceTypes,
  TestResult,
} from "../api/types";
import { ErrorBox, Spinner } from "../components/common";
import { ConnectorForm, type Config } from "../components/ConnectorForm";

const TABS = ["Connectors", "Secrets", "Prompts", "MCP"] as const;
type Tab = (typeof TABS)[number];

/** Human interval, because 3600 tells you less than "1 h" at a glance. */
function humanSeconds(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const delta = (Date.now() - new Date(iso).getTime()) / 1000;
  const future = delta < 0;
  const abs = Math.abs(delta);
  const value =
    abs < 60 ? `${Math.round(abs)}s`
      : abs < 3600 ? `${Math.round(abs / 60)}m`
        : abs < 86400 ? `${Math.round(abs / 3600)}h`
          : `${Math.round(abs / 86400)}d`;
  return future ? `in ${value}` : `${value} ago`;
}

const INTERVALS = [60, 300, 900, 3600, 21600, 86400];

// ---------------------------------------------------------------- connectors
function ConnectorsTab() {
  const [types, setTypes] = useState<SourceTypes | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const [spec, setSpec] = useState<ConnectorSpec | null>(null);
  // Set only when editing an existing source. Creating leaves it null, and the
  // two paths are genuinely different: POST upserts on (collection, name) and
  // therefore cannot rename — a renamed source would become a second one,
  // polling alongside the original.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>({});
  const [name, setName] = useState("");
  const [collection, setCollection] = useState("");
  const [interval, setInterval] = useState(3600);
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, SourceRun[]>>({});

  const load = useCallback(async () => {
    try {
      const [t, s, c] = await Promise.all([
        api.sourceTypes(),
        api.sources(),
        api.collections(),
      ]);
      setTypes(t);
      setSources(s);
      setCollections(c);
      if (!collection && c.length) setCollection(c[0].name);
      // Secrets need the admin scope; a write-only key still gets the rest of
      // the screen rather than a blank page.
      try {
        setSecrets(await api.secrets());
      } catch {
        setSecrets([]);
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [collection]);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (chosen: ConnectorSpec) => {
    setSpec(chosen);
    setEditingId(null);
    setTest(null);
    setName(chosen.name);
    const defaults: Config = {};
    for (const field of chosen.fields) {
      if (field.default !== null && field.default !== undefined && !field.advanced) {
        defaults[field.name] = field.default;
      }
    }
    setConfig(defaults);
  };

  const edit = (source: Source) => {
    const found = types?.types.find((t) => t.name === source.type);
    if (!found) return;
    setSpec(found);
    setEditingId(source.id);
    setTest(null);
    setName(source.name);
    setCollection(source.collection);
    setInterval(source.interval_seconds);
    setConfig((source.config ?? {}) as Config);
  };

  const runTest = async () => {
    if (!spec) return;
    setBusy("test");
    setTest(null);
    try {
      setTest(await api.testSource(spec.name, config));
    } catch (e) {
      setTest({ ok: false, message: String((e as Error).message ?? e), detail: {} });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!spec) return;
    setBusy("save");
    try {
      if (editingId) {
        await api.updateSource(editingId, {
          collection,
          name,
          type: spec.name,
          config,
          interval_seconds: interval,
        });
      } else {
        await api.createSource({
          collection,
          name,
          type: spec.name,
          config,
          interval_seconds: interval,
          enabled: true,
        });
      }
      setSpec(null);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const toggleRuns = async (source: Source) => {
    if (runs[source.id]) {
      const next = { ...runs };
      delete next[source.id];
      setRuns(next);
      return;
    }
    setRuns({ ...runs, [source.id]: await api.sourceRuns(source.id) });
  };

  if (loading) return <Spinner label="loading connectors" />;

  return (
    <div>
      <ErrorBox error={error} />

      {!types?.vault_enabled && (
        <div className="alert warn">
          <strong>The secret vault is off</strong>
          <span className="small">
            <code>SECRETS_KEY</code> is not set, so credentials cannot be stored
            here. Generate one with <code>make secrets-key</code>, put it in{" "}
            <code>.env</code> and restart. Until then, <code>{"${NAME}"}</code>{" "}
            references resolve from the worker's environment only.
          </span>
        </div>
      )}

      <section className="panel">
        <h2>Registered sources</h2>
        {sources.length === 0 && (
          <p className="muted small">
            Nothing registered yet. Pick a connector below — the form is built
            from the connector's own schema, so it always matches what the
            backend actually reads.
          </p>
        )}
        {sources.map((s) => (
          <div key={s.id} className="rowitem">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>{s.name}</strong>{" "}
                <span className="badge">{s.type}</span>{" "}
                <span className="chip">{s.collection}</span>{" "}
                {!s.enabled && <span className="badge warn">disabled</span>}
                {s.last_status === "ok" && <span className="badge ok">ok</span>}
                {s.last_status === "error" && <span className="badge bad">error</span>}
              </div>
              <div className="row">
                <button className="small" onClick={() => void toggleRuns(s)}>
                  {runs[s.id] ? "Hide history" : "History"}
                </button>
                <button className="small" onClick={() => edit(s)}>
                  Edit
                </button>
                <button
                  className="small"
                  onClick={async () => {
                    setBusy(s.id);
                    try {
                      await api.syncSource(s.id);
                      setTimeout(() => void load(), 1500);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === s.id ? "…" : "Sync now"}
                </button>
                <button
                  className="small danger"
                  onClick={async () => {
                    await api.deleteSource(s.id);
                    await load();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="muted small" style={{ marginTop: 4 }}>
              every {humanSeconds(s.interval_seconds)} · last run{" "}
              {relative(s.last_run_at)}
              {s.next_run_at && s.enabled && ` · next ${relative(s.next_run_at)}`}
            </p>
            {s.last_error && <div className="alert error small">{s.last_error}</div>}
            {runs[s.id] && (
              <table className="runs">
                <thead>
                  <tr>
                    <th>started</th>
                    <th>trigger</th>
                    <th>status</th>
                    <th>took</th>
                    <th>docs</th>
                    <th>new</th>
                    <th>same</th>
                    <th>failed</th>
                  </tr>
                </thead>
                <tbody>
                  {runs[s.id].length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted small">
                        no runs recorded yet
                      </td>
                    </tr>
                  )}
                  {runs[s.id].map((r) => (
                    <tr key={r.id} title={r.error ?? ""}>
                      <td>{relative(r.started_at)}</td>
                      <td>{r.trigger}</td>
                      <td className={r.status === "error" ? "bad" : ""}>{r.status}</td>
                      <td>{r.duration_ms === null ? "—" : `${r.duration_ms} ms`}</td>
                      <td>{r.documents}</td>
                      <td>{r.indexed}</td>
                      <td>{r.unchanged}</td>
                      <td>{r.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>
          {spec
            ? `${editingId ? "Edit" : "Configure"} ${spec.label}`
            : "Add a source"}
        </h2>

        {!spec && (
          <div className="connectors">
            {types?.types.map((t) => (
              <button key={t.name} className="connector" onClick={() => pick(t)}>
                <strong>{t.label}</strong>
                <span className="muted small">{t.description}</span>
                <span className="chips">
                  <span className="chip">{t.fields.length} fields</span>
                  {t.testable && <span className="chip">testable</span>}
                </span>
              </button>
            ))}
          </div>
        )}

        {spec && (
          <div>
            <p className="muted small">{spec.description}</p>

            <div className="field">
              <label>Source name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="field">
              <label>Collection</label>
              <select value={collection} onChange={(e) => setCollection(e.target.value)}>
                {collections.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Poll interval</label>
              <select
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
              >
                {INTERVALS.map((s) => (
                  <option key={s} value={s}>
                    every {humanSeconds(s)}
                  </option>
                ))}
              </select>
              <p className="muted small">
                The schedule lives in the database, not in a crontab: a worker
                ticks every minute and dispatches whatever is due, so changing
                this takes effect without a redeploy. Minimum 60&nbsp;s.
              </p>
            </div>

            <hr />

            <ConnectorForm
              spec={spec}
              config={config}
              secrets={secrets}
              vaultEnabled={Boolean(types?.vault_enabled)}
              onChange={setConfig}
            />

            {test && (
              <div className={`alert ${test.ok ? "ok" : "error"}`}>
                <strong>{test.ok ? "Connection OK" : "Test failed"}</strong>
                <span className="small">{test.message}</span>
              </div>
            )}

            <div className="row" style={{ marginTop: 14 }}>
              <button
                onClick={() => {
                  setSpec(null);
                  setEditingId(null);
                }}
              >
                Cancel
              </button>
              <span className="spacer" />
              <button onClick={runTest} disabled={busy === "test"}>
                {busy === "test" ? "Testing…" : "Test connection"}
              </button>
              <button className="primary" onClick={save} disabled={busy === "save"}>
                {busy === "save"
                  ? "Saving…"
                  : editingId
                    ? "Save changes"
                    : "Create source"}
              </button>
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              Test before saving. The alternative is discovering a typo in{" "}
              <code>last_error</code> an interval later.
              {editingId &&
                " Editing keeps the cursor, so changing an interval or a filter does not re-fetch history."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------- secrets
function SecretsTab() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setSecrets(await api.secrets());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    setBusy(true);
    try {
      await api.createSecret({ name, value, description: description || undefined });
      setName("");
      setValue("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="loading secrets" />;

  return (
    <div>
      <ErrorBox error={error} />

      <section className="panel">
        <h2>Stored credentials</h2>
        <p className="muted small">
          Encrypted with AES-256-GCM under <code>SECRETS_KEY</code>, which lives
          in the server environment and never reaches this browser.{" "}
          <strong>There is no endpoint that reads a secret back</strong> — the
          last four characters below are all the API will ever return, which is
          enough to tell two tokens apart and not enough to use one.
        </p>

        {secrets.length === 0 && (
          <p className="muted small">Nothing stored yet.</p>
        )}
        {secrets.map((s) => (
          <div key={s.name} className="rowitem row" style={{ justifyContent: "space-between" }}>
            <div>
              <code>{"${" + s.name + "}"}</code>{" "}
              <span className="chip">…{s.hint}</span>
              {s.used_by.length > 0 ? (
                s.used_by.map((u) => (
                  <span key={u} className="chip">
                    {u}
                  </span>
                ))
              ) : (
                <span className="badge warn" title="No source config references it">
                  unused
                </span>
              )}
              <p className="muted small" style={{ marginTop: 4 }}>
                {s.description ? `${s.description} · ` : ""}
                updated {relative(s.updated_at)} · last used {relative(s.last_used_at)}
              </p>
            </div>
            <button
              className="small danger"
              onClick={async () => {
                await api.deleteSecret(s.name);
                await load();
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Add a credential</h2>
        <div className="field">
          <label>
            Name <code className="muted small">referenced as {"${NAME}"}</code>
          </label>
          <input
            placeholder="SLACK_BOT_TOKEN"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
          />
        </div>
        <div className="field">
          <label>Value</label>
          <input
            type="password"
            placeholder="xoxb-…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Description</label>
          <input
            placeholder="Slack bot token for #incidents"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <button className="primary" onClick={add} disabled={busy || !name || !value}>
          {busy ? "Encrypting…" : "Store"}
        </button>
        <p className="muted small" style={{ marginTop: 8 }}>
          Saving the same name again replaces the value; every source
          referencing it picks the new one up on its next poll, with no restart.
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------- prompts
function PromptsTab() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    try {
      setPrompts((await api.prompts()).prompts);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const expand = async (prompt: Prompt) => {
    if (open === prompt.key) {
      setOpen(null);
      return;
    }
    setOpen(prompt.key);
    setDraft(prompt.body);
    setNote("");
    setSaved(null);
    setError(null);
    setVersions((await api.promptVersions(prompt.key, prompt.collection)).versions);
  };

  const save = async (prompt: Prompt) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await api.savePrompt(prompt.key, {
        body: draft,
        collection: prompt.collection,
        note: note || undefined,
      });
      setSaved(
        result.unchanged
          ? `Unchanged — still v${result.version}`
          : `Saved as v${result.version} and activated`,
      );
      setVersions((await api.promptVersions(prompt.key, prompt.collection)).versions);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="loading prompts" />;

  return (
    <div>
      <ErrorBox error={error} />
      <div className="alert warn">
        <strong>Editing a prompt changes every answer this service gives.</strong>
        <span className="small">
          Run <code>make eval</code> after a change: it scores retrieval,
          groundedness and abstention against a golden set, so a prompt that
          reads better but answers worse does not ship silently.
        </span>
      </div>

      {prompts.map((p) => (
        <section key={`${p.key}:${p.collection ?? ""}`} className="panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{p.label}</strong>{" "}
              <code className="muted small">{p.key}</code>{" "}
              <span className="chip">{p.collection ?? "global"}</span>{" "}
              <span className={p.is_default ? "badge" : "badge warn"}>
                v{p.version} {p.is_default ? "default" : "edited"}
              </span>
            </div>
            <button className="small" onClick={() => void expand(p)}>
              {open === p.key ? "Close" : "Edit"}
            </button>
          </div>
          <p className="muted small">{p.description}</p>

          {open === p.key && (
            <div style={{ marginTop: 12 }}>
              {p.required_placeholders.length > 0 && (
                <p className="muted small">
                  Must contain:{" "}
                  {p.required_placeholders.map((ph) => (
                    <code key={ph}>{`{${ph}}`}</code>
                  ))}
                  . A literal brace has to be doubled — <code>{"{{"}</code>.
                </p>
              )}
              <textarea
                rows={14}
                className="mono"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="row" style={{ marginTop: 8 }}>
                <input
                  style={{ flex: 1 }}
                  placeholder="What changed and why (kept in the version history)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button
                  className="primary"
                  onClick={() => void save(p)}
                  disabled={busy || draft === p.body}
                >
                  {busy ? "Saving…" : "Save new version"}
                </button>
                <button
                  onClick={async () => {
                    await api.resetPrompt(p.key, p.collection);
                    await load();
                    setOpen(null);
                  }}
                >
                  Reset to default
                </button>
              </div>
              {saved && <div className="alert ok small">{saved}</div>}

              <h3 className="small" style={{ marginTop: 16 }}>
                History ({versions.length})
              </h3>
              {versions.map((v) => (
                <div key={v.id} className="rowitem row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <span className={v.is_active ? "badge ok" : "badge"}>v{v.version}</span>{" "}
                    <span className="muted small">
                      {v.created_by ?? "—"} · {relative(v.created_at)}
                      {v.note ? ` · ${v.note}` : ""}
                    </span>
                  </div>
                  <div className="row">
                    <button className="small" onClick={() => setDraft(v.body)}>
                      Load
                    </button>
                    {!v.is_active && (
                      <button
                        className="small"
                        onClick={async () => {
                          await api.activatePromptVersion(v.id);
                          setVersions(
                            (await api.promptVersions(p.key, p.collection)).versions,
                          );
                          await load();
                        }}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <p className="muted small">
                Versions are immutable — a trace records the version that
                produced it, so an answer from last month stays explainable
                after the prompt has moved on.
              </p>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------- MCP
function McpTab() {
  const key = getApiKey();
  const base = `${window.location.origin}/v1`;

  const clientConfig = JSON.stringify(
    {
      mcpServers: {
        "rag-core": {
          command: "python",
          args: ["-m", "app.mcp_server"],
          env: { RAG_API_URL: base, RAG_API_KEY: key || "rag_sk_…" },
        },
      },
    },
    null,
    2,
  );

  return (
    <div>
      <section className="panel">
        <h2>Agents connecting to this service</h2>
        <p className="muted small">
          The MCP server is a thin stdio client over the REST API — it exposes
          the same tools with the same guardrails, so an agent cannot reach
          retrieval by a path that skips the confidence gate.
        </p>
        <p className="muted small">
          Paste this into the MCP client config (Claude Desktop, Cursor, or your
          orchestrator app):
        </p>
        <pre className="mono block">{clientConfig}</pre>
        {!key && (
          <div className="alert warn small">
            No API key is set in this browser, so the snippet has a placeholder.
          </div>
        )}
        <h3 className="small">Tools exposed</h3>
        <ul className="muted small">
          <li>
            <code>rag_search</code> — retrieval only, no model tokens. Use it
            when the agent will do its own reasoning over the passages.
          </li>
          <li>
            <code>rag_answer</code> — full guarded answer: citations validated,
            groundedness judged, abstention when the corpus cannot support it.
          </li>
          <li>
            <code>rag_ingest</code> — write back what an incident taught, so the
            next agent finds it.
          </li>
          <li>
            <code>rag_feedback</code> — mark which passages actually helped;
            this feeds ranking.
          </li>
          <li>
            <code>rag_list_collections</code> — discover what is indexed.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>This service consuming other MCP servers</h2>
        <p className="muted small">
          The opposite direction, and a separate thing: the{" "}
          <code>mcp</code> connector in the Connectors tab makes the worker an
          MCP <em>client</em>, so a vendor's own MCP server becomes a data
          source. That is usually less work than a per-vendor connector — GitHub,
          Sentry and Linear all ship one.
        </p>
        <p className="muted small">
          Two caveats worth knowing before you configure it. With{" "}
          <code>stdio</code> the command runs inside the worker container, so{" "}
          <code>npx</code> has to exist there. And a tool with no{" "}
          <code>since</code>-style argument cannot be polled incrementally — it
          refetches everything each interval, and only content hashing keeps
          that from re-embedding.
        </p>
        <p className="muted small">
          Leave <strong>Tool name</strong> blank and press{" "}
          <strong>Test connection</strong> to list what a server exposes. MCP
          tool names are rarely guessable.
        </p>
      </section>
    </div>
  );
}

// -------------------------------------------------------------------- screen
export default function Setup() {
  const [tab, setTab] = useState<Tab>("Connectors");
  return (
    <div>
      <div className="subnav">
        {TABS.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Connectors" && <ConnectorsTab />}
      {tab === "Secrets" && <SecretsTab />}
      {tab === "Prompts" && <PromptsTab />}
      {tab === "MCP" && <McpTab />}
    </div>
  );
}
