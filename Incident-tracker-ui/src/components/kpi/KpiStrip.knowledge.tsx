import { BookOpen, FileQuestion, ShieldCheck } from "lucide-react";
import { useKnowledge } from "../../api/dashboard/knowledge";
import { PanelBoundary } from "../shared/PanelBoundary";
import { KpiTile } from "./KpiTile";
import { KpiRow } from "./KpiRow";

// FR-099/K1: the three Knowledge-tab tiles. Unlike Performance's tiles (FR-082), nothing in the
// PRD makes these click targets — they're read-only context for the panels below.
export function KpiStripKnowledge() {
  const { data, isLoading, isError, error, refetch } = useKnowledge();

  return (
    <PanelBoundary
      isLoading={isLoading}
      isError={isError}
      errorMessage={(error as Error | undefined)?.message}
      onRetry={refetch}
      data={data}
      isEmpty={() => false}
      emptyNoDataMessage="Knowledge data arrives once documents are indexed and incidents are resolved."
      skeleton={
        <div className="h-[86px] animate-pulse rounded-lg border border-border bg-muted/50">
          <span className="sr-only">Loading tiles…</span>
        </div>
      }
    >
      {(knowledge) => (
        <KpiRow>
          <KpiTile
            icon={BookOpen}
            label="Knowledge documents"
            value={knowledge.tiles.knowledgeDocumentCount}
            sub={`${knowledge.tiles.distinctDocumentTypeCount} document types`}
          />
          <KpiTile
            icon={ShieldCheck}
            label="Services with a runbook"
            value={knowledge.tiles.servicesWithRunbookCount}
            sub={`of ${knowledge.tiles.totalServiceCount}`}
          />
          <KpiTile
            icon={FileQuestion}
            label="Undocumented resolutions"
            value={knowledge.tiles.undocumentedResolutionCount}
            severity={knowledge.tiles.undocumentedResolutionCount > 0 ? "cautionary" : "none"}
          />
        </KpiRow>
      )}
    </PanelBoundary>
  );
}
