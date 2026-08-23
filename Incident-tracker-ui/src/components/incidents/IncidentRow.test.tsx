import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { IncidentRow } from "./IncidentRow";
import type { IncidentRow as IncidentRowData } from "../../api/incidents/list";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

const baseIncident: IncidentRowData = {
  id: "inc-1042",
  externalId: "INC-1042",
  priority: "P1",
  status: "INVESTIGATING",
  title: "Connection pool exhausted",
  serviceName: "payments-api",
  environment: "Production",
  category: "Database",
  isKnownIncident: true,
  bestMatchScore: 0.97,
  confidenceScore: 0.91,
  createdAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  assignedTo: "a.reyes",
  automationStatus: "needs_human",
  source: "PagerDuty",
  candidateReason: null,
  recurrenceCount: null,
};

function renderRow(incident: IncidentRowData = baseIncident) {
  return render(
    <table>
      <tbody>
        <IncidentRow incident={incident} />
      </tbody>
    </table>,
  );
}

describe("IncidentRow", () => {
  it("opens the drawer via URL state on click, with no page navigation (IT-1)", async () => {
    renderRow();
    fireEvent.click(screen.getByRole("row"));
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("incident")).toBe("inc-1042");
    });
  });

  it("opens the drawer on Enter for keyboard users (A11Y-3)", async () => {
    renderRow();
    fireEvent.keyDown(screen.getByRole("row"), { key: "Enter" });
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("incident")).toBe("inc-1042");
    });
  });

  it("renders a source-badge icon in the title cell (IT-6)", () => {
    renderRow();
    expect(screen.getByText("PD")).toBeInTheDocument();
    expect(screen.getByText("Connection pool exhausted")).toBeInTheDocument();
  });

  it('renders "Unassigned" as a styled warning, not blank, when nobody owns it', () => {
    renderRow({ ...baseIncident, assignedTo: null });
    const el = screen.getByText("Unassigned");
    expect(el).toHaveAttribute("data-warning", "true");
  });

  it("flags age once it passes the per-priority threshold (P1: 30m)", () => {
    const old = { ...baseIncident, createdAt: new Date(Date.now() - 45 * 60_000).toISOString() };
    renderRow(old);
    const ageCell = screen.getByText(/45m/);
    expect(ageCell).toHaveAttribute("data-flagged", "true");
  });

  it("does not flag age under the threshold", () => {
    renderRow(baseIncident); // 18m, under P1's 30m
    const ageCell = screen.getByText(/18m/);
    expect(ageCell).toHaveAttribute("data-flagged", "false");
  });

  it("visually distinguishes ESCALATED from OPEN while keeping a text label (A11Y-1)", () => {
    renderRow({ ...baseIncident, status: "ESCALATED" });
    expect(screen.getByText("ESCALATED")).toHaveAttribute("data-status", "ESCALATED");
  });

  it("de-emphasises non-production environments while keeping the text label", () => {
    renderRow({ ...baseIncident, environment: "Staging" });
    expect(screen.getByText("Staging")).toHaveAttribute("data-nonprod", "true");
  });
});
