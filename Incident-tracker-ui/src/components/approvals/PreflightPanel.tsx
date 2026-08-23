import { Check, TriangleAlert, X } from "lucide-react";
import type { PreflightCheck, PreflightStatus, PreflightVerdict } from "../../api/approvals/preflight";
import { usePreflight } from "../../api/approvals/preflight";

interface PreflightPanelProps {
  actionId: string;
}

// Icon plus word, never colour alone (AR-1/A11Y-1) — and these three in particular must not rely
// on red-vs-green, which is the one pair colour vision cannot separate.
const ICONS: Record<PreflightStatus, typeof Check> = {
  pass: Check,
  warn: TriangleAlert,
  fail: X,
};

const ICON_TONE: Record<PreflightStatus, string> = {
  pass: "text-ok",
  warn: "text-warn",
  fail: "text-bad",
};

const STATUS_WORD: Record<PreflightStatus, string> = {
  pass: "Ready",
  warn: "Caution",
  fail: "Blocked",
};

const VERDICT_TONE: Record<PreflightVerdict, string> = {
  blocked: "border-bad/30 bg-chip-bad-bg text-bad",
  dry_run: "border-border bg-muted text-muted-foreground",
  will_run: "border-warn/30 bg-chip-warn-bg text-warn",
};

function CheckRow({ check }: { check: PreflightCheck }) {
  const Icon = ICONS[check.status];
  return (
    <li className="flex gap-2.5 border-t border-border-soft py-2.5 first:border-t-0 first:pt-0">
      <Icon aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 ${ICON_TONE[check.status]}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium text-foreground">{check.label}</span>
          <span className="sr-only">{STATUS_WORD[check.status]}</span>
        </span>
        <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{check.detail}</span>
      </span>
    </li>
  );
}

// FR-035/FR-036's third panel, which used to say "Not yet available" because the API carried no
// pre-flight checks. It does now: GET /api/actions/:id/preflight runs the same guards the
// executors run — the tool registry, EXECUTION_ALLOWED_HOSTS, the repository allowlist, the
// dry-run flag — and reports them before the decision instead of after it.
//
// The question this answers is the one the two other panels do not: "Proposed change" says what
// would be done and "Evidence" says why, and neither says whether pressing Approve does anything
// at all.
export function PreflightPanel({ actionId }: PreflightPanelProps) {
  const { data, isLoading, isError, error } = usePreflight(actionId, true);

  if (isLoading) {
    return (
      <div className="h-28 animate-pulse rounded-lg border border-border bg-muted/40">
        <span className="sr-only">Running pre-flight checks…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
        <p className="text-[13px] font-medium text-muted-foreground">
          Pre-flight checks are unavailable
        </p>
        {/* The warning stays whatever the server said. Rendering only the error message meant a
            response with a body silently dropped the one sentence that matters — a failed panel
            must never read as "all clear", and an operator who cannot see the checks is deciding
            without them. */}
        <p className="mt-1 text-[12.5px] text-subtle-foreground">
          Approving is still possible; you are deciding without this.
        </p>
        {(error as Error | undefined)?.message && (
          <p className="mt-2 text-[12px] text-subtle-foreground">
            {(error as Error).message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* The verdict first, in words. A list of green ticks with one red cross buried in it makes
          the reader do the summarising, and the summary is the whole product. */}
      <p
        className={`rounded-lg border px-3 py-2 text-[13px] font-medium ${VERDICT_TONE[data.verdict]}`}
      >
        {data.summary}
      </p>
      <ul className="mt-3">
        {data.checks.map((check) => (
          <CheckRow key={check.key} check={check} />
        ))}
      </ul>
    </div>
  );
}
