import { useRef, type KeyboardEvent } from "react";
import { Activity, BarChart3, BookOpen, Bot } from "lucide-react";
import { useUrlState } from "../../state/useUrlState";
import type { Tab } from "../../domain/filters";

const TABS: ReadonlyArray<{ key: Tab; label: string; icon: typeof Activity }> = [
  { key: "now", label: "Now", icon: Activity },
  { key: "performance", label: "Performance", icon: BarChart3 },
  { key: "agent", label: "Agent", icon: Bot },
  { key: "knowledge", label: "Knowledge", icon: BookOpen },
];

interface TabBarProps {
  pendingApprovalCount: number;
}

// TB-1..TB-3: tablist/tab/aria-selected with roving-tabindex arrow-key navigation, tab state
// via useUrlState, Now's badge hidden at zero (never rendered as "0").
export function TabBar({ pendingApprovalCount }: TabBarProps) {
  const { tab, setTab } = useUrlState();
  const buttonRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const moveFocus = (currentIndex: number, delta: number) => {
    const nextIndex = (currentIndex + delta + TABS.length) % TABS.length;
    const nextTab = TABS[nextIndex].key;
    setTab(nextTab);
    buttonRefs.current[nextTab]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(index, 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(index, -1);
    }
  };

  return (
    <div className="border-b border-border bg-card">
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="mx-auto flex w-full max-w-[1360px] gap-1 px-6 py-2"
      >
        {TABS.map((entry, index) => {
          const isSelected = tab === entry.key;
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              ref={(el) => {
                buttonRefs.current[entry.key] = el;
              }}
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              // The selected state hangs off aria-selected, so the visual state can never drift
              // from the state assistive tech is told about. A filled tint reads more clearly at
              // this density than a thin underline, without adding visual weight to the chrome.
              className="group flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground aria-selected:bg-selected-bg aria-selected:font-semibold aria-selected:text-primary aria-selected:hover:bg-selected-bg"
              onClick={() => setTab(entry.key)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <Icon
                aria-hidden="true"
                className="size-[15px] text-subtle-foreground transition-colors group-aria-selected:text-primary"
              />
              {entry.label}
              {entry.key === "now" && pendingApprovalCount > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground shadow-2xs">
                  {pendingApprovalCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
