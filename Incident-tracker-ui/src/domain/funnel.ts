export type FunnelStageKey =
  | "received"
  | "classified"
  | "ragMatched"
  | "recommended"
  | "approvedOrAutoRun"
  | "executedSuccessfully"
  | "validatedResolved";

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  count: number | null;
  dropCount: number | null; // null only for "received" (FR-088) or an unavailable stage
}

// FR-083: percentage of the stage immediately above — never of "received", which has no stage
// above it.
export function percentOfStageAbove(stages: FunnelStage[], index: number): number | null {
  if (index === 0) return null;
  const current = stages[index].count;
  const above = stages[index - 1].count;
  if (current === null || above === null || above === 0) return null;
  return Math.round((current / above) * 100);
}

// What the bar LENGTH encodes: this stage as a share of the first one.
//
// percentOfStageAbove is the stage-to-stage conversion rate and belongs in the label, not in a
// length. Drawn as width it produced a funnel that widened: "Action recommended" kept all 8
// incidents from "RAG match found", so its 100% drew a full-width bar below that stage's 62% —
// same count, longer bar, and the one shape a funnel must never make.
export function shareOfFirstStage(stages: FunnelStage[], index: number): number | null {
  const current = stages[index].count;
  const first = stages[0]?.count;
  if (current === null || current === undefined) return null;
  if (first === null || first === undefined || first === 0) return null;
  return Math.round((current / first) * 100);
}

export interface LargestDrop {
  fromLabel: string;
  toLabel: string;
  magnitude: number;
}

// FR-084: the largest stage-to-stage drop, computed from dropCount itself — never a fixed
// narrative — so it stays correct however the underlying counts change.
export function largestDrop(stages: FunnelStage[]): LargestDrop | null {
  let best: LargestDrop | null = null;
  for (let i = 1; i < stages.length; i++) {
    const dropCount = stages[i].dropCount;
    if (dropCount === null) continue;
    if (best === null || dropCount > best.magnitude) {
      best = { fromLabel: stages[i - 1].label, toLabel: stages[i].label, magnitude: dropCount };
    }
  }
  return best;
}

// contracts/incidents-endpoints.md: `funnelDropAt=<key>` is FR-085's drop-set (stages 1+);
// `funnelStage=received` is FR-088's distinct "no preceding stage, jump to everything" case — two
// different query params, not one, so the caller needs to know which kind it got.
export interface DropSetSelection {
  kind: "funnelDropAt" | "funnelStage";
  key: FunnelStageKey;
  label: string;
  unavailable?: true;
}

// FR-085/FR-086/FR-087/FR-088: the drop-set filter for a stage click. The first stage has no
// preceding stage, so it jumps to everything in range instead (FR-088). A zero-loss stage stays a
// normal, clickable drop-set (FR-087) — only a stage with no data at all (dropCount AND count
// both null, beyond "received") is flagged unavailable, since no filter could ever match it.
export function dropSetFor(stages: FunnelStage[], index: number): DropSetSelection {
  const stage = stages[index];
  if (index === 0) {
    return { kind: "funnelStage", key: "received", label: "All incidents in range" };
  }
  if (stage.count === null && stage.dropCount === null) {
    return { kind: "funnelStage", key: stage.key, label: `${stage.label} is not yet available`, unavailable: true };
  }
  const previous = stages[index - 1];
  return { kind: "funnelDropAt", key: stage.key, label: `Reached ${previous.label} but not ${stage.label}` };
}
