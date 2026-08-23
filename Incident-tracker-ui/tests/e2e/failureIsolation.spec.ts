import { test, expect } from "@playwright/test";

// Principle VIII/SC-011/FR-106: a component's failure must never take down the dashboard — each
// panel fails and retries independently. Pre-registers a failing MSW handler via page.addInitScript
// + the __pendingMswErrors test hook (main.tsx, dev-only) so the targeted endpoint fails from the
// very first request — Playwright's page.route can't intercept requests a Service Worker fully
// answers itself, and invalidating an already-loaded query after the fact races React's
// mount/observer timing under StrictMode. Confirms every other panel stays interactive.

function failEndpoint(path: string, status: number, message: string) {
  return async (page: import("@playwright/test").Page) => {
    await page.addInitScript(
      ([p, s, m]) => {
        window.__pendingMswErrors = [...(window.__pendingMswErrors ?? []), [p, s, m]];
      },
      [path, status, message] as const,
    );
  };
}

test("the alert strip's own endpoint failing leaves every other panel interactive (AS-*)", async ({ page }) => {
  await failEndpoint("/api/dashboard/alert-strip", 500, "Simulated alert-strip outage")(page);
  await page.goto("/?tab=now");

  await expect(page.getByRole("status")).toContainText(/simulated alert-strip outage/i);

  // Everything else stays fully interactive: the table, and every tab.
  await expect(page.locator("#incident-table")).toBeVisible();
  await page.getByRole("tab", { name: /^performance$/i }).click();
  await expect(page.getByRole("region", { name: /automation funnel/i })).toBeVisible();
  await page.getByRole("tab", { name: /^knowledge$/i }).click();
  await expect(page.getByRole("region", { name: /runbook coverage gaps/i })).toBeVisible();
});

test("the Performance query failing shows an independent error per panel, without affecting Breakdowns or other tabs", async ({
  page,
}) => {
  await failEndpoint("/api/dashboard/performance", 500, "Simulated performance outage")(page);
  await page.goto("/?tab=performance");

  // KpiStripPerformance, AutomationFunnelPanel, and ExecutionOutcomeDonutPanel each independently
  // render their own error — proving isolation, not one shared crash.
  const alerts = page.getByRole("alert").filter({ hasText: /simulated performance outage/i });
  await expect(alerts).toHaveCount(3);

  // Breakdowns-backed panels use a different query entirely and stay unaffected.
  await expect(page.getByRole("region", { name: /incident volume/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /breakdown by priority/i })).toBeVisible();

  // Other tabs remain fully interactive.
  await page.getByRole("tab", { name: /^now/i }).click();
  await expect(page.locator("#incident-table")).toBeVisible();
  await page.getByRole("tab", { name: /^knowledge$/i }).click();
  await expect(page.getByRole("region", { name: /runbook coverage gaps/i })).toBeVisible();
});

test("the incident list failing leaves the Now-tab KPI tiles and approval queue interactive", async ({ page }) => {
  await failEndpoint("/api/incidents", 500, "Simulated incident-list outage")(page);
  await page.goto("/?tab=now");

  const tableAlert = page.locator("#incident-table").getByRole("alert");
  await expect(tableAlert).toContainText(/simulated incident-list outage/i);
  await expect(tableAlert.getByRole("button", { name: /retry/i })).toBeVisible();

  // KPI tiles and the approval queue use their own queries and stay interactive.
  await expect(page.getByRole("button", { name: /open incidents/i })).toBeVisible();
  const approveButtons = page.getByRole("button", { name: /^approve$/i });
  await expect(approveButtons.first()).toBeVisible();
  await expect(approveButtons.first()).toBeEnabled();
});
