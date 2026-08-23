import type { ReactNode } from "react";
import type { Tab } from "../../domain/filters";

interface TabPanelProps {
  tab: Tab;
  activeTab: Tab;
  children?: ReactNode;
}

// TB-4: every panel stays mounted; only visibility toggles via the native `hidden` attribute,
// which excludes it from the accessibility tree and tab order for free and means a tab switch
// is never a mount event — nothing here can trigger a refetch or a skeleton (research.md §11).
export function TabPanel({ tab, activeTab, children }: TabPanelProps) {
  return (
    // No display utility is applied here on purpose: the native `hidden` attribute is what
    // hides an inactive panel (TB-4), and a Tailwind `block`/`grid` class would out-specify it.
    <section role="tabpanel" aria-label={tab} hidden={tab !== activeTab} className="pt-[18px]">
      {children}
    </section>
  );
}
