import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OperatorProvider } from "../../state/OperatorContext";
import { useOperatorNameGate } from "./useOperatorNameGate";

function TriggerHarness({ onComplete }: { onComplete: (name: string) => void }) {
  const { requireOperatorName, operatorNamePrompt } = useOperatorNameGate();
  return (
    <>
      <button onClick={() => requireOperatorName((name) => onComplete(name))}>Approve</button>
      {operatorNamePrompt}
    </>
  );
}

function renderHarness(onComplete: (name: string) => void) {
  render(
    <OperatorProvider>
      <TriggerHarness onComplete={onComplete} />
    </OperatorProvider>,
  );
}

describe("OperatorNamePrompt / useOperatorNameGate", () => {
  it("does not complete the triggering action until a name is supplied (FR-120)", () => {
    const calls: string[] = [];
    renderHarness((name) => calls.push(name));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(calls).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: /your name/i })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a.reyes" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(calls).toEqual(["a.reyes"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not open the prompt or block the action once a name already exists (FR-121)", () => {
    window.localStorage.setItem("incident-tracker:operator-name", "a.reyes");
    const calls: string[] = [];
    renderHarness((name) => calls.push(name));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(calls).toEqual(["a.reyes"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    window.localStorage.clear();
  });

  it("cancelling leaves the action uncompleted", () => {
    const calls: string[] = [];
    renderHarness((name) => calls.push(name));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
