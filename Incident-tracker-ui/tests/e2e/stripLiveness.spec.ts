import { test, expect } from "@playwright/test";

// AS-1..AS-8/FR-015/SC-012/SC-013: the alert strip polls every 30s regardless of the active tab —
// a "new P1" arriving must surface with no tab switch and no manual refresh, and every tab must
// read the identical, already-updated count once it has (never a stale value on one tab and a
// fresh one on another). Uses MSW's own worker.use() via the __mswOverride test hook (main.tsx,
// dev-only) rather than Playwright's page.route: a request a Service Worker fully answers itself
// never reaches Playwright's network-interception layer, so page.route can't simulate this.
test("the alert strip updates within one polling interval with no tab switch or refresh, and reads identically regardless of active tab", async ({
  page,
}) => {
  test.setTimeout(45_000);

  await page.goto("/?tab=now");

  const strip = page.getByRole("status");
  const initialText = (await strip.textContent()) ?? "";
  const initialP1 = Number(initialText.match(/(\d+)\s+P1 active/)?.[1] ?? "0");
  const newP1Active = initialP1 + 1;

  // Switch to Performance *before* the new P1 arrives — the strip must keep polling regardless of
  // which tab is active (AS-1/AS-8).
  await page.getByRole("tab", { name: /^performance$/i }).click();

  await page.evaluate((p1Active) => {
    window.__mswOverride?.("/api/dashboard/alert-strip", {
      p1Active,
      awaitingApproval: 3,
      oldestPendingAgeMinutes: 34,
      autoExecutedCountInRange: 5,
    });
  }, newP1Active);

  await expect(strip).toContainText(`${newP1Active} P1 active`, { timeout: 35_000 });

  // Switching tabs again must show the identical, already-updated count (SC-012) — not a second,
  // separately-triggered fetch racing the tab switch.
  await page.getByRole("tab", { name: /^now/i }).click();
  await expect(strip).toContainText(`${newP1Active} P1 active`);
});
