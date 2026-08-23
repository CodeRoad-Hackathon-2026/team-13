import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { PanelBoundary } from "./PanelBoundary";

function Harness(props: Partial<ComponentProps<typeof PanelBoundary<string[]>>>) {
  return (
    <PanelBoundary<string[]>
      isLoading={false}
      isError={false}
      data={["a"]}
      isEmpty={(d) => d.length === 0}
      emptyNoDataMessage="Incidents arrive from email and PagerDuty."
      skeleton={<div data-testid="skeleton" />}
      {...props}
    >
      {(data) => <div data-testid="content">{data.join(",")}</div>}
    </PanelBoundary>
  );
}

describe("PanelBoundary", () => {
  it("renders the skeleton while loading", () => {
    render(<Harness isLoading data={undefined as unknown as string[]} />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("renders an inline retryable error on fetch failure", () => {
    const onRetry = vi.fn();
    render(
      <Harness
        isError
        errorMessage="Network error"
        onRetry={onRetry}
        data={undefined as unknown as string[]}
      />,
    );
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders the empty-no-data message when data is empty and no filter is active", () => {
    render(<Harness data={[]} isFiltered={false} />);
    expect(screen.getByText(/incidents arrive from email/i)).toBeInTheDocument();
  });

  it("renders a distinct empty-filtered message with a clear control when filtered", () => {
    const onClear = vi.fn();
    render(
      <Harness
        data={[]}
        isFiltered
        emptyFilteredMessage="No incidents match these filters."
        onClearFilters={onClear}
      />,
    );
    expect(screen.getByText(/no incidents match these filters/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("renders the children with data on success", () => {
    render(<Harness data={["a", "b"]} />);
    expect(screen.getByTestId("content")).toHaveTextContent("a,b");
  });

  it("catches a render-time error thrown by its children and shows a retryable error instead of crashing", () => {
    const onRetry = vi.fn();
    const Boom = () => {
      throw new Error("boom");
    };
    const originalError = console.error;
    console.error = () => {};
    render(
      <PanelBoundary<string[]>
        isLoading={false}
        isError={false}
        data={["a"]}
        isEmpty={() => false}
        emptyNoDataMessage="none"
        skeleton={<div />}
        onRetry={onRetry}
      >
        {() => <Boom />}
      </PanelBoundary>,
    );
    console.error = originalError;
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
