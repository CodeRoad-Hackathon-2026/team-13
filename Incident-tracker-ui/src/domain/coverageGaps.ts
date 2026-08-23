export interface CoverageGapService {
  serviceId: string;
  serviceName: string;
  knownRate: number;
}

// FR-100/K2: worst first — the point of this chart is "what's broken," so burying the worst
// service at the bottom (as a volume-sorted chart would) defeats it.
export function sortAscendingByKnownRate(services: CoverageGapService[]): CoverageGapService[] {
  return [...services].sort((a, b) => a.knownRate - b.knownRate);
}

// FR-101/K2: names the single highest-leverage fix explicitly — a caption that requires the
// reader to infer it from a chart usually doesn't get read.
export function highestLeverageFixCaption(services: CoverageGapService[]): string | null {
  if (services.length === 0) return null;
  const worst = sortAscendingByKnownRate(services)[0];
  return `Fixing ${worst.serviceName} would move the funnel more than any model change.`;
}
