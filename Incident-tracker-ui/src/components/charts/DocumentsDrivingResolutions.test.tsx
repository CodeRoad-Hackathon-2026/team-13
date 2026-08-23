import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentsDrivingResolutions } from "./DocumentsDrivingResolutions";
import type { DocumentDrivingResolution } from "../../api/dashboard/knowledge";

const documents: DocumentDrivingResolution[] = [
  {
    documentId: "doc-2",
    documentType: "INCIDENT",
    title: "INC-842 — payments-db pool exhausted",
    resolutionCount: 19,
  },
  { documentId: "doc-1", documentType: "RUNBOOK", title: "Runbook #42", resolutionCount: 23 },
  { documentId: "doc-4", documentType: "POSTMORTEM", title: "PM-2026-03", resolutionCount: 9 },
];

describe("DocumentsDrivingResolutions", () => {
  it("ranks documents by resolution count, descending (FR-102,K3)", () => {
    render(<DocumentsDrivingResolutions documents={documents} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Runbook #42"),
      expect.stringContaining("INC-842"),
      expect.stringContaining("PM-2026-03"),
    ]);
  });

  it("shows the document-type badge and resolution count for each row", () => {
    render(<DocumentsDrivingResolutions documents={documents} />);
    const runbookRow = screen.getByText("Runbook #42").closest("li");
    expect(runbookRow).toHaveTextContent("RUNBOOK");
    expect(runbookRow).toHaveTextContent("23");
  });

  it("offers an accessible table view fed the same data (A11Y-4)", () => {
    render(<DocumentsDrivingResolutions documents={documents} />);
    expect(screen.getByRole("button", { name: /view as table/i })).toBeInTheDocument();
  });
});
