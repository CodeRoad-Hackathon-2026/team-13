import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CrossTabFilterChip } from "./CrossTabFilterChip";
import type { ActiveFilter } from "../../domain/filters";

describe("CrossTabFilterChip", () => {
  it("names the active filter and renders distinctly when cross-tab-originated (FR-022,XT-3)", () => {
    const filter: ActiveFilter = {
      kind: "funnelStage",
      key: "ragMatched",
      label: "Reached classified but not RAG match found",
      isCrossTab: true,
    };
    render(<CrossTabFilterChip filter={filter} onClear={vi.fn()} />);

    const chip = screen
      .getByText("Reached classified but not RAG match found")
      .closest("[data-cross-tab]");
    expect(chip).toHaveAttribute("data-cross-tab", "true");
  });

  it("renders same-tab filters without the cross-tab styling", () => {
    const filter: ActiveFilter = {
      kind: "kpiTile",
      key: "openIncidents",
      label: "Open incidents",
      isCrossTab: false,
    };
    render(<CrossTabFilterChip filter={filter} onClear={vi.fn()} />);

    const chip = screen.getByText("Open incidents").closest("[data-cross-tab]");
    expect(chip).toHaveAttribute("data-cross-tab", "false");
  });

  it("clearing calls onClear only — the caller decides tab behaviour, and clearFilter itself never touches the tab (FR-024,XT-5)", () => {
    const onClear = vi.fn();
    const filter: ActiveFilter = {
      kind: "funnelStage",
      key: "recommended",
      label: "Recommended",
      isCrossTab: true,
    };
    render(<CrossTabFilterChip filter={filter} onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
