import "./styles/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

declare global {
  interface Window {
    __mswOverride?: (path: string, body: Record<string, unknown>) => void;
    __pendingMswErrors?: Array<[path: string, status: number, message: string]>;
  }
}

async function enableMocking() {
  if (!import.meta.env.DEV) return;
  // VITE_USE_API=true points the app at the real backend through the Vite proxy.
  // MSW's worker answers requests itself, so it has to be off for the proxy to
  // ever see them.
  if (import.meta.env.VITE_USE_API === "true") return;
  const { worker } = await import("./api/fixtures/browser");
  const { http, HttpResponse } = await import("msw");
  // e2e-test-only hook: Playwright's page.route can't intercept requests MSW's own Service
  // Worker fully answers itself, so tests that need to simulate a live data change
  // (stripLiveness.spec.ts) call this to install a one-off handler via MSW's own worker.use().
  window.__mswOverride = (path, body) => {
    worker.use(http.get(path, () => HttpResponse.json(body)));
  };
  // e2e-test-only hook: failureIsolation.spec.ts pre-populates this via page.addInitScript
  // (before this module runs) so a targeted endpoint fails from the very first request — avoids
  // racing an invalidateQueries() call against React's mount/observer timing after the fact.
  for (const [path, status, message] of window.__pendingMswErrors ?? []) {
    worker.use(http.get(path, () => new HttpResponse(message, { status })));
  }
  await worker.start({ onUnhandledRequest: "warn" });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

enableMocking().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
