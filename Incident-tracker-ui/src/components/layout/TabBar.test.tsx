import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TabBar } from "./TabBar";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("TabBar", () => {
  it("exposes proper tablist/tab roles with aria-selected on the active tab", () => {
    render(<TabBar pendingApprovalCount={0} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole("tab", { name: /^now$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /performance/i })).toHaveAttribute("aria-selected", "false");
  });

  it("moves selection and focus with the right arrow key", () => {
    render(<TabBar pendingApprovalCount={0} />);
    screen.getByRole("tab", { name: /^now$/i }).focus();
    fireEvent.keyDown(screen.getByRole("tab", { name: /^now$/i }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /performance/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /performance/i })).toHaveFocus();
  });

  it("wraps with the left arrow key from the first tab to the last", () => {
    render(<TabBar pendingApprovalCount={0} />);
    screen.getByRole("tab", { name: /^now$/i }).focus();
    fireEvent.keyDown(screen.getByRole("tab", { name: /^now$/i }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /knowledge/i })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the Now badge with the pending-approval count when above zero", () => {
    render(<TabBar pendingApprovalCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it('hides the Now badge entirely at zero rather than rendering "0"', () => {
    render(<TabBar pendingApprovalCount={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("persists the active tab in the URL", () => {
    render(<TabBar pendingApprovalCount={0} />);
    fireEvent.click(screen.getByRole("tab", { name: /knowledge/i }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("knowledge");
  });
});
