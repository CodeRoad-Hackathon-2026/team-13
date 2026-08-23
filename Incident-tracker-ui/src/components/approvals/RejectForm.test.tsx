import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RejectForm } from "./RejectForm";

describe("RejectForm", () => {
  it("refuses submission with an empty reason (FR-038,§11.3)", async () => {
    const onSubmit = vi.fn();
    render(<RejectForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /submit rejection/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/reason is required/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses submission with a whitespace-only reason", async () => {
    const onSubmit = vi.fn();
    render(<RejectForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /submit rejection/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/reason is required/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits with just a reason when no corrections are given", async () => {
    const onSubmit = vi.fn();
    render(<RejectForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), {
      target: { value: "Already fixed manually" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit rejection/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ reason: "Already fixed manually", correctedCategory: "", correctedPriority: "" });
  });

  it("accepts optional corrected category and priority (AR-6)", async () => {
    const onSubmit = vi.fn();
    render(<RejectForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Miscategorized" } });
    fireEvent.change(screen.getByRole("textbox", { name: /corrected category/i }), { target: { value: "Network" } });
    fireEvent.change(screen.getByRole("combobox", { name: /corrected priority/i }), { target: { value: "P2" } });
    fireEvent.click(screen.getByRole("button", { name: /submit rejection/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        reason: "Miscategorized",
        correctedCategory: "Network",
        correctedPriority: "P2",
      }),
    );
  });

  it("calls onCancel without submitting", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<RejectForm onSubmit={onSubmit} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
