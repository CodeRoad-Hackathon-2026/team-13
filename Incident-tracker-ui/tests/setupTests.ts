import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts runs with `globals: false`, so @testing-library/react's automatic
// afterEach(cleanup) registration (which relies on a global test framework) never fires.
// Without this, every test's rendered DOM leaks into the next test in the same file.
afterEach(cleanup);

// jsdom doesn't implement scrollIntoView at all (every real browser does) — every cross-tab-jump
// flash target (IncidentTable, ApprovalQueue) calls it, so this stub is a test-environment gap
// fill, not a feature-detection concern for production code.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
