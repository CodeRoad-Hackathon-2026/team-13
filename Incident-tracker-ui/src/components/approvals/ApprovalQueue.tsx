import { useEffect, useRef, useState } from "react";
import { usePendingApprovals } from "../../api/approvals/pending";
import type { PendingApprovalCard, PendingApprovalsData } from "../../api/approvals/pending";
import { APPROVAL_QUEUE_FLASH_EVENT } from "../layout/AlertStrip";
import { PanelBoundary } from "../shared/PanelBoundary";
import { ApprovalCard } from "./ApprovalCard";
import { SectionHeader } from "../shared/SectionHeader";

const FLASH_DURATION_MS = 1500;

// FR-031/FR-032/FR-046/FR-047: one query, its own isolation boundary. Lives on the Now tab but is
// reachable from the alert strip's button on any tab, which switches tab then flashes this into
// view (APPROVAL_QUEUE_FLASH_EVENT). Cards MUST key by id, never array index (FR-042/§11.19) — a
// sibling card's executing state/timer/poll must survive another card resolving or being removed.
//
// Deliberately keeps its own local `cards` list rather than rendering `data.cards` directly: the
// server's own list only ever contains PROPOSED actions, so any refetch of it would silently drop
// an already-approved card that's still showing itself execute in place (§11.19). This local list
// is seeded from each fetch (including an intentional manual refresh) and otherwise only ever
// shrinks via a card's own confirmed rejection (onRejected), never via a background refetch.
export function ApprovalQueue() {
  const { data, isLoading, isError, error, refetch } = usePendingApprovals();
  const [cards, setCards] = useState<PendingApprovalCard[] | null>(null);
  // Adjusting local state during render (React's own pattern for "derive from a changed prop"),
  // rather than an effect — this fires only when `data` is a genuinely new fetch (initial load or
  // an intentional manual refresh), never as a side effect of another card's own mutation.
  const [seededFrom, setSeededFrom] = useState<PendingApprovalsData | undefined>(undefined);
  if (data && data !== seededFrom) {
    setSeededFrom(data);
    setCards(data.cards);
  }
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleFlash() {
      const node = containerRef.current;
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      node.setAttribute("data-flash", "true");
      setTimeout(() => node.removeAttribute("data-flash"), FLASH_DURATION_MS);
    }
    window.addEventListener(APPROVAL_QUEUE_FLASH_EVENT, handleFlash);
    return () => window.removeEventListener(APPROVAL_QUEUE_FLASH_EVENT, handleFlash);
  }, []);

  const view: PendingApprovalsData | undefined =
    cards && data ? { cards, autoExecutedCountInRange: data.autoExecutedCountInRange } : undefined;

  return (
    // The alert strip's "awaiting approval" button jumps here from any tab (§13: the queue is
    // never behind a tab of its own), then fires the flash this ring renders.
    <div
      id="approval-queue"
      ref={containerRef}
      className="mt-6 scroll-mt-[180px] rounded-lg transition-shadow data-[flash=true]:ring-2 data-[flash=true]:ring-ring"
    >
      <SectionHeader
        title="Pending approvals"
        meta={view ? `${view.cards.length} awaiting review` : undefined}
      />
      <PanelBoundary
        isLoading={isLoading}
        isError={isError}
        errorMessage={(error as Error | undefined)?.message}
        onRetry={refetch}
        data={view}
        isEmpty={(d) => d.cards.length === 0}
        emptyNoDataMessage={
          <p>
            All clear — {view?.autoExecutedCountInRange ?? 0} actions executed automatically in the
            last 7 days.
          </p>
        }
        skeleton={
          <div className="animate-pulse rounded-lg border border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground shadow-xs">
            Loading approvals…
          </div>
        }
      >
        {(pending) => (
          <ul className="grid gap-3.5">
            {pending.cards.map((card) => (
              <ApprovalCard
                key={card.id}
                card={card}
                onRejected={() => setCards((prev) => prev?.filter((c) => c.id !== card.id) ?? prev)}
              />
            ))}
          </ul>
        )}
      </PanelBoundary>
    </div>
  );
}
