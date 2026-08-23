import { ArrowUpRight } from "lucide-react";

// The shape the backend parses a unified diff into. Line numbers come from the
// hunk headers, so they are the file's real numbers, not a count from one.
export interface DiffLine {
  kind: "add" | "del" | "context";
  old: number | null;
  new: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface ProposedChangeData {
  repo: string | null;
  branch: string | null;
  base: string;
  summary: string | null;
  files: DiffFile[];
  additions: number;
  deletions: number;
}

// Tinted rows, but the +/- gutter carries the same information as text — the
// distinction between an added and a removed line is not one to leave to colour
// (A11Y-1), least of all on a change someone is about to approve.
const ROW = "grid grid-cols-[3rem_1.25rem_1fr] items-start font-mono text-[12px] leading-[1.7]";
const ROW_BY_KIND: Record<DiffLine["kind"], string> = {
  add: "bg-chip-ok-bg",
  del: "bg-chip-bad-bg",
  context: "",
};
const MARK_BY_KIND: Record<DiffLine["kind"], string> = {
  add: "text-ok",
  del: "text-bad",
  context: "text-transparent",
};
const MARK_TEXT: Record<DiffLine["kind"], string> = { add: "+", del: "−", context: " " };

export function ProposedChange({ change }: { change: ProposedChangeData }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/50 px-3.5 py-2.5">
        {change.repo && <span className="meta">{change.repo}</span>}
        {change.branch && (
          <>
            <span className="text-subtle-foreground">/</span>
            <span className="font-mono text-[13px]">{change.branch}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2.5">
          <span className="meta">
            {change.files.length} {change.files.length === 1 ? "file" : "files"}
          </span>
          <span className="font-mono text-[12px] font-semibold text-ok">+{change.additions}</span>
          <span className="font-mono text-[12px] font-semibold text-bad">−{change.deletions}</span>
        </span>
      </div>

      {change.files.map((file) => (
        <div key={file.path} className="border-b border-border-soft last:border-b-0">
          <p className="border-b border-border-soft px-3.5 py-2 font-mono text-[12px] text-muted-foreground">
            {file.path}
          </p>
          {file.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              {hunk.header && (
                <p className="bg-muted/40 px-3.5 py-1 font-mono text-[11.5px] text-subtle-foreground">
                  {hunk.header}
                </p>
              )}
              {hunk.lines.map((line, lineIndex) => (
                <div key={lineIndex} className={`${ROW} ${ROW_BY_KIND[line.kind]}`}>
                  {/* One gutter, showing the line as it will be numbered after
                      the change — a removed line has no such number. */}
                  <span className="select-none px-2 text-right text-subtle-foreground">
                    {line.new ?? line.old ?? ""}
                  </span>
                  <span className={`select-none text-center ${MARK_BY_KIND[line.kind]}`}>
                    {MARK_TEXT[line.kind]}
                  </span>
                  <span className="whitespace-pre-wrap break-all pr-3.5">{line.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-3.5 py-2.5">
        <span className="meta">{change.summary ?? "not yet merged"}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(toUnifiedDiff(change))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Copy diff
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </button>
      </div>
    </div>
  );
}

// Rebuilt from the parsed form rather than carried alongside it: one source of
// truth means what gets copied is exactly what is on screen.
function toUnifiedDiff(change: ProposedChangeData): string {
  return change.files
    .map((file) => {
      const header = `--- a/${file.path}\n+++ b/${file.path}`;
      const body = file.hunks
        .map((hunk) =>
          hunk.lines
            .map(
              (line) =>
                `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`,
            )
            .join("\n"),
        )
        .join("\n");
      return `${header}\n${body}`;
    })
    .join("\n");
}
