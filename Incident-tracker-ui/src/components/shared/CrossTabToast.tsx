import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { CROSS_TAB_TOAST_EVENT } from "../../state/useCrossTabJump";

const TOAST_DURATION_MS = 4000;

// FR-023/XT-4: names what happened on every cross-tab jump — mounted once near the app root, like
// the alert strip, so it can catch a jump fired from any tab.
export function CrossTabToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<{ message: string }>).detail;
      setMessage(detail.message);
    }
    window.addEventListener(CROSS_TAB_TOAST_EVENT, handleToast);
    return () => window.removeEventListener(CROSS_TAB_TOAST_EVENT, handleToast);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(null), TOAST_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [message]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13px] text-primary-foreground shadow-xl"
    >
      <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
      {message}
    </div>
  );
}
