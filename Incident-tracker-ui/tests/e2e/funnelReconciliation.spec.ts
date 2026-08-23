import { test, expect } from "@playwright/test";

// SC-005/SC-014/§11.4/§11.5/§11.15, FR-085/FR-086: a funnel drop-set click's filtered row count
// must exactly match the drop count displayed on the funnel itself, rolled-back must never be
// folded into failed, and the jump must be legible on its own (flash + chip + toast together).
test("a funnel drop-set click's row count exactly matches its displayed drop count", async ({ page }) => {
  await page.goto("/?tab=performance");

  const ragMatchedRow = page.getByRole("button", { name: /rag match found/i });
  await expect(ragMatchedRow).toContainText("−44");

  await ragMatchedRow.click();

  // Legible without documentation: tab switch, flash, chip, and toast are all present together.
  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();
  await expect(page.locator("#incident-table")).toHaveAttribute("data-flash", "true");
  await expect(page.locator("[data-cross-tab='true']").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /jumped to now/i })).toBeVisible();

  await expect(page.getByText(/showing \d+ of 44/i)).toBeVisible();
});

test("a zero-loss funnel stage jumps to a filtered-empty state, distinguishable from no data", async ({ page }) => {
  await page.goto("/?tab=performance");

  await page.getByRole("button", { name: /classified by ai/i }).click();

  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();
  await expect(page.getByText(/no incidents match these filters/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /clear filters/i })).toBeVisible();
});

test("rolled-back executions never appear folded into failed, anywhere on Performance", async ({ page }) => {
  await page.goto("/?tab=performance");

  const outcomes = page.getByRole("region", { name: /execution outcomes/i });
  const failedRow = outcomes.getByRole("listitem").filter({ hasText: "FAILED" });
  const rolledBackRow = outcomes.getByRole("listitem").filter({ hasText: "ROLLED BACK" });

  await expect(failedRow).toContainText("6");
  await expect(rolledBackRow).toContainText("3");
  await expect(failedRow).not.toContainText("9");
});
