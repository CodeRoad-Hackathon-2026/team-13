import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabPanel } from "./TabPanel";

describe("TabPanel", () => {
  it("renders visibly when it is the active tab", () => {
    render(
      <TabPanel tab="now" activeTab="now">
        <button>Inside Now</button>
      </TabPanel>,
    );
    expect(screen.getByText("Inside Now")).toBeVisible();
  });

  it("stays mounted but hidden via the native hidden attribute when not the active tab (TB-4)", () => {
    render(
      <TabPanel tab="performance" activeTab="now">
        <button>Inside Performance</button>
      </TabPanel>,
    );
    // Still in the DOM — proves it's mounted, not conditionally rendered.
    const content = screen.getByText("Inside Performance");
    expect(content).toBeInTheDocument();
    // Excluded from the accessibility tree / visual rendering via `hidden`.
    expect(content).not.toBeVisible();
    expect(content.closest("[hidden]")).not.toBeNull();
  });
});
