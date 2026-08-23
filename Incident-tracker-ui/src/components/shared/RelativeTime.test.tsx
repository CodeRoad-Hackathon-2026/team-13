import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RelativeTime } from "./RelativeTime";

const clock = { now: () => new Date("2026-08-16T12:00:00Z") };

describe("RelativeTime", () => {
  it("renders a relative label by default", () => {
    render(<RelativeTime timestamp="2026-08-16T11:56:00Z" clock={clock} />);
    expect(screen.getByText(/4m ago/i)).toBeInTheDocument();
  });

  it("shows the absolute time with timezone on hover via the title attribute", () => {
    render(<RelativeTime timestamp="2026-08-16T11:56:00Z" clock={clock} />);
    const el = screen.getByText(/4m ago/i);
    expect(el.getAttribute("title")).toMatch(/2026/);
  });

  it("falls back to hours for older timestamps", () => {
    render(<RelativeTime timestamp="2026-08-16T09:30:00Z" clock={clock} />);
    expect(screen.getByText(/2h 30m ago/i)).toBeInTheDocument();
  });
});
