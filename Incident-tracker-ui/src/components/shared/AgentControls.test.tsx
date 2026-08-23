import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";
import { ToggleSwitch } from "./ToggleSwitch";

describe("SegmentedControl", () => {
  const options = [
    { value: "observe", label: "Observe" },
    { value: "act", label: "Act" },
  ] as const;

  it("marks the selected option with aria-pressed, not with colour alone", () => {
    render(
      <SegmentedControl label="Autonomy" value="act" options={options} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Act" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Observe" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports the value the operator chose", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Autonomy" value="act" options={options} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Observe" }));

    expect(onChange).toHaveBeenCalledWith("observe");
  });

  // An option the server will refuse is shown and explained rather than hidden:
  // a missing option looks like it was never designed.
  it("disables an option the server would refuse, and carries the reason", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Autonomy"
        value="observe"
        options={[
          { value: "observe", label: "Observe" },
          { value: "act", label: "Act", disabledReason: "Off on this server." },
        ]}
        onChange={onChange}
      />,
    );

    const refused = screen.getByRole("button", { name: "Act" });
    expect(refused).toBeDisabled();
    expect(refused).toHaveAttribute("title", "Off on this server.");

    fireEvent.click(refused);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a group, so a screen reader announces what the row is for", () => {
    render(
      <SegmentedControl label="HIGH risk policy" value="act" options={options} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("group", { name: "HIGH risk policy" })).toBeInTheDocument();
  });

  it("disables every option when the whole control is inactive", () => {
    render(
      <SegmentedControl
        label="Autonomy"
        value="act"
        options={options}
        onChange={vi.fn()}
        disabled
      />,
    );

    for (const option of options) {
      expect(screen.getByRole("button", { name: option.label })).toBeDisabled();
    }
  });
});

describe("ToggleSwitch", () => {
  it("is a switch with its state in aria-checked", () => {
    render(<ToggleSwitch label="Skill enabled" checked onChange={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "Skill enabled" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // AR-1/A11Y-1: never colour alone. A knob's position is colour and shape.
  it("carries a text state beside it", () => {
    render(<ToggleSwitch label="Skill enabled" checked={false} onChange={vi.fn()} />);

    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("reports the flipped value", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Skill enabled" checked={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch"));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does nothing when disabled", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Skill enabled" checked onChange={onChange} disabled />);

    fireEvent.click(screen.getByRole("switch"));

    expect(onChange).not.toHaveBeenCalled();
  });
});
