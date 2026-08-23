import { useConnections } from "../../api/agents/connections";
import { CardHeader } from "../shared/CardHeader";
import { SECTION } from "../shared/sectionStyles";

// "ok" | "error" | null, and null is its own answer. A source nobody has polled
// yet is not a broken one, and folding the two together would invent a failure.
const STATUS_LABEL: Record<string, string> = { ok: "Last run ok", error: "Last run failed" };
const STATUS_TONE: Record<string, string> = { ok: "text-ok", error: "text-bad" };

// Where the corpus comes from. Read-only, and read-only for a reason worth
// stating: editing a source means handling its credentials, and the RAG key this
// dashboard's backend holds has admin scope over that service's secrets.
export function ConnectionsPanel() {
  const { data, isLoading } = useConnections();

  return (
    <section aria-label="Connections" className={`${SECTION} shadow-xs`}>
      <CardHeader title="Connections" meta="knowledge sources" />
      {isLoading && <p className="text-[13px] text-muted-foreground">Loading…</p>}

      {data?.unavailable && (
        <p className="text-[13px] text-muted-foreground">{data.unavailable}</p>
      )}

      {data && !data.unavailable && data.sources.length === 0 && (
        <p className="text-[13px] text-muted-foreground">
          No source is configured, so the corpus only holds what the orchestrator has
          written into it.
        </p>
      )}

      {data && data.sources.length > 0 && (
        <ul>
          {data.sources.map((source) => (
            <li
              key={source.id}
              className="border-t border-border-soft py-2.5 first:border-t-0 first:pt-0"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] text-foreground">
                  {source.name}
                </span>
                <span
                  className={`meta shrink-0 text-[11.5px] ${
                    source.lastStatus ? STATUS_TONE[source.lastStatus] ?? "" : ""
                  }`}
                >
                  {source.lastStatus
                    ? STATUS_LABEL[source.lastStatus] ?? source.lastStatus
                    : "never run"}
                </span>
              </div>
              <p className="meta mt-0.5 text-[11.5px]">
                {source.type}
                {!source.enabled && " · paused"}
              </p>
              {source.lastError && (
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {source.lastError}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-border-soft pt-3 text-[12px] text-subtle-foreground">
        Managed in RAG Core, behind its own key — a source's credentials never pass
        through this dashboard.
      </p>
    </section>
  );
}
