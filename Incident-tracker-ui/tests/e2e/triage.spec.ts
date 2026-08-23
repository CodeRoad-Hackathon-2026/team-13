import { test, expect } from "@playwright/test";

// SC-002/SC-003, FR-116: the golden-path triage flow — progressive load order, then drilling from
// a KPI tile into a specific incident and reading every drawer section without leaving the page.
test("golden-path triage: load order, KPI drill-down, row click, full drawer read", async ({ page }) => {
  await page.goto("/?tab=now");

  const alertStrip = page.getByRole("status").first();
  await expect(alertStrip).toBeVisible();

  const openIncidentsTile = page.getByRole("button", { name: /open incidents/i });
  await expect(openIncidentsTile).toBeVisible();

  // US3 added charts to Performance, but panels stay mounted regardless of the active tab
  // (TB-4) — the chart exists in the DOM already, just not painted. "Tiles readable before any
  // chart has drawn" means not visible yet, not "doesn't exist".
  await expect(page.locator("svg.recharts-surface").first()).not.toBeVisible();

  await openIncidentsTile.click();
  await expect(openIncidentsTile).toHaveAttribute("data-active", "true");

  const firstRow = page.getByRole("row").nth(1);
  await firstRow.click();

  const dialog = page.getByRole("dialog", { name: /incident detail/i });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByRole("group", { name: /incident actions/i })).toBeVisible();
  await expect(dialog.getByRole("region", { name: /ai classification/i })).toBeVisible();
  await expect(dialog.getByRole("region", { name: /agent run trace/i })).toBeVisible();
  await expect(dialog.getByRole("region", { name: /similarity matches/i })).toBeVisible();
  await expect(dialog.getByRole("region", { name: /recommended actions/i })).toBeVisible();
  await expect(dialog.getByRole("region", { name: /event timeline/i })).toBeVisible();
});
