import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export interface UseFocusTrapOptions {
  // "firstElement" (default) focuses the first focusable child — fine when that child is a
  // non-destructive call to action (e.g. the confirm modal's "Confirm approve"). "container"
  // focuses the dialog container itself instead: required when the first focusable child is a
  // dismiss control (e.g. the drawer's "Close"), since a keyboard-triggered open (Enter on a
  // non-native element, which has no native activation of its own) can still have its keyUP
  // in flight when the trap moves focus — landing that keyUP's native "Enter activates the
  // focused button" behavior on Close and self-dismissing the very thing that just opened.
  initialFocus?: "firstElement" | "container";
}

// A11Y-3: traps Tab/Shift+Tab within the container while active, restores focus to whatever was
// focused before activation once deactivated. Used by the drawer and the HIGH-risk confirm modal.
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean,
  options?: UseFocusTrapOptions,
): void {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const initialFocus = options?.initialFocus ?? "firstElement";

  useEffect(() => {
    if (!isActive) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (!container) return;

    const getFocusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (initialFocus === "container") {
      container.focus();
    } else {
      getFocusable()[0]?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [isActive, containerRef, initialFocus]);
}
