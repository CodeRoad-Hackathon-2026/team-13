import { Component, type ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";

// The four-state switch every panel that owns a query renders through (Principle VII), wrapped
// in an error boundary so a render-time failure degrades this panel only (Principle VIII).

export interface PanelBoundaryProps<T> {
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  data: T | undefined;
  isEmpty: (data: T) => boolean;
  isFiltered?: boolean;
  emptyNoDataMessage: ReactNode;
  emptyFilteredMessage?: ReactNode;
  onClearFilters?: () => void;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}

// Principle VIII: an error is rendered inside the panel's own footprint, sized like the content
// it replaces, so one failed panel visibly degrades itself and nothing around it.
const EMPTY_CLASS =
  "grid justify-items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground";

function PanelError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="grid justify-items-center gap-2 rounded-lg border border-bad/20 bg-chip-bad-bg px-4 py-8 text-center text-[13px] shadow-xs"
    >
      <AlertTriangle aria-hidden="true" className="size-5 text-bad" />
      <p className="text-bad">{message ?? "Something went wrong loading this panel."}</p>
      {onRetry && (
        <button
          className="mt-1 rounded-lg border border-bad/20 bg-card px-3 py-1.5 text-[13px] font-medium text-bad shadow-2xs transition-colors hover:bg-muted"
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
}

interface BoundaryState {
  caughtError: Error | null;
}

class RenderErrorBoundary extends Component<
  { onRetry?: () => void; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { caughtError: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { caughtError: error };
  }

  handleRetry = (): void => {
    this.setState({ caughtError: null });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (this.state.caughtError) {
      return <PanelError message={this.state.caughtError.message} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

export function PanelBoundary<T>({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  data,
  isEmpty,
  isFiltered = false,
  emptyNoDataMessage,
  emptyFilteredMessage,
  onClearFilters,
  skeleton,
  children,
}: PanelBoundaryProps<T>) {
  return (
    <RenderErrorBoundary onRetry={onRetry}>
      {isLoading && skeleton}
      {!isLoading && isError && <PanelError message={errorMessage} onRetry={onRetry} />}
      {!isLoading && !isError && data !== undefined && isEmpty(data) && !isFiltered && (
        <div className={EMPTY_CLASS}>
          <Inbox aria-hidden="true" className="size-5 text-subtle-foreground" />
          {emptyNoDataMessage}
        </div>
      )}
      {!isLoading && !isError && data !== undefined && isEmpty(data) && isFiltered && (
        <div className={EMPTY_CLASS}>
          <Inbox aria-hidden="true" className="size-5 text-subtle-foreground" />
          {emptyFilteredMessage}
          {onClearFilters && (
            <button
              className="mx-auto mt-1 block rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-muted-foreground shadow-2xs transition-colors hover:bg-muted hover:text-foreground"
              onClick={onClearFilters}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {!isLoading && !isError && data !== undefined && !isEmpty(data) && children(data)}
    </RenderErrorBoundary>
  );
}
