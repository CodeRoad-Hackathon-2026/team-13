import { render, screen, fireEvent } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

function Harness() {
  const [active, setActive] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, active);

  return (
    <div>
      <button data-testid="trigger" onClick={() => setActive(true)}>
        Open
      </button>
      {active && (
        <div ref={containerRef} data-testid="trap">
          <button data-testid="first">First</button>
          <button data-testid="last">Last</button>
        </div>
      )}
      <button
        data-testid="close"
        onClick={() => setActive(false)}
        style={{ display: active ? "none" : "block" }}
      >
        placeholder
      </button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("focuses the first focusable element when activated", () => {
    render(<Harness />);
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("wraps Tab from the last element back to the first", () => {
    render(<Harness />);
    screen.getByTestId("last").focus();
    fireEvent.keyDown(screen.getByTestId("trap"), { key: "Tab" });
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    render(<Harness />);
    screen.getByTestId("first").focus();
    fireEvent.keyDown(screen.getByTestId("trap"), { key: "Tab", shiftKey: true });
    expect(screen.getByTestId("last")).toHaveFocus();
  });

  it("restores focus to the triggering element when deactivated", () => {
    function RestoreHarness() {
      const [active, setActive] = useState(false);
      const containerRef = useRef<HTMLDivElement>(null);
      useFocusTrap(containerRef, active);
      return (
        <div>
          <button data-testid="trigger" onClick={() => setActive(true)}>
            Open
          </button>
          {active && (
            <div ref={containerRef} data-testid="trap">
              <button data-testid="inside">Inside</button>
              <button data-testid="closeBtn" onClick={() => setActive(false)}>
                Close
              </button>
            </div>
          )}
        </div>
      );
    }
    render(<RestoreHarness />);
    screen.getByTestId("trigger").focus();
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("inside")).toHaveFocus();
    fireEvent.click(screen.getByTestId("closeBtn"));
    expect(screen.getByTestId("trigger")).toHaveFocus();
  });
});
