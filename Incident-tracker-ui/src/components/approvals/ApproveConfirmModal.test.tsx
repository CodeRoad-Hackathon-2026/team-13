import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApproveConfirmGate } from "./useApproveConfirmGate";
import type { RiskLevel } from "../../api/types";

function TriggerHarness({ riskLevel, onConfirmed }: { riskLevel: RiskLevel; onConfirmed: () => void }) {
  const { requestApprove, confirmModal } = useApproveConfirmGate("Restart the payments-db connection pool");
  return (
    <>
      <button onClick={() => requestApprove(riskLevel, onConfirmed)}>Approve</button>
      {confirmModal}
    </>
  );
}

describe("ApproveConfirmModal / useApproveConfirmGate", () => {
  it("requires a second explicit click for a HIGH-risk action, restating the action (FR-037,§11.2)", () => {
    const onConfirmed = vi.fn();
    render(<TriggerHarness riskLevel="HIGH" onConfirmed={onConfirmed} />);

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(onConfirmed).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /confirm/i });
    expect(dialog).toHaveTextContent("Restart the payments-db connection pool");

    fireEvent.click(screen.getByRole("button", { name: /confirm approve/i }));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("skips the confirmation entirely for LOW risk — one click approves (FR-037)", () => {
    const onConfirmed = vi.fn();
    render(<TriggerHarness riskLevel="LOW" onConfirmed={onConfirmed} />);

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("skips the confirmation entirely for MEDIUM risk", () => {
    const onConfirmed = vi.fn();
    render(<TriggerHarness riskLevel="MEDIUM" onConfirmed={onConfirmed} />);

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancelling a HIGH-risk confirmation leaves the action unconfirmed", () => {
    const onConfirmed = vi.fn();
    render(<TriggerHarness riskLevel="HIGH" onConfirmed={onConfirmed} />);

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("traps focus inside the confirmation modal while open (A11Y-3)", () => {
    const onConfirmed = vi.fn();
    render(<TriggerHarness riskLevel="HIGH" onConfirmed={onConfirmed} />);

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: /confirm approve/i }));
  });
});
