import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriorityPill } from "./PriorityPill";
import { StatusPill } from "./StatusPill";

describe("PriorityPill", () => {
  it.each(["P1", "P2", "P3", "P4"] as const)(
    "renders a text label for %s, not colour alone",
    (priority) => {
      render(<PriorityPill priority={priority} />);
      expect(screen.getByText(priority)).toBeInTheDocument();
    },
  );
});

describe("StatusPill", () => {
  it.each(["OPEN", "ESCALATED", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"] as const)(
    "renders a text label for %s, including the two new v2.0 status values",
    (status) => {
      render(<StatusPill status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
    },
  );

  it("marks ESCALATED as visually distinct from OPEN via a data attribute, not colour alone", () => {
    render(<StatusPill status="ESCALATED" />);
    expect(screen.getByText("ESCALATED")).toHaveAttribute("data-status", "ESCALATED");
  });
});
