import { test, expect } from "@playwright/test";

// FR-097/FR-098/SC-004: a breakdown-segment click must produce the identical cross-tab jump
// sequence (switch to Now, flash the table, distinct chip, toast) as a funnel-stage click — the
// same useCrossTabJump call site US3 built, reused rather than rebuilt.
test("clicking a priority breakdown segment produces the same cross-tab jump sequence as a funnel stage", async ({
  page,
}) => {
  await page.goto("/?tab=performance");

  const p1Segment = page.getByRole("region", { name: /breakdown by priority/i }).getByRole("button", { name: /P1/i });
  await p1Segment.click();

  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();
  await expect(page.locator("#incident-table")).toHaveAttribute("data-flash", "true");
  await expect(page.locator("[data-cross-tab='true']").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /jumped to now/i })).toBeVisible();
});

test("clicking a category breakdown segment jumps identically", async ({ page }) => {
  await page.goto("/?tab=performance");

  await page
    .getByRole("region", { name: /breakdown by category/i })
    .getByRole("button", { name: /database/i })
    .click();

  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();
  await expect(page.locator("[data-cross-tab='true']").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /jumped to now/i })).toBeVisible();
});

test("clicking a service breakdown segment jumps identically", async ({ page }) => {
  await page.goto("/?tab=performance");

  await page
    .getByRole("region", { name: /breakdown by service/i })
    .getByRole("button", { name: /payments-api/i })
    .click();

  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();
  await expect(page.locator("[data-cross-tab='true']").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /jumped to now/i })).toBeVisible();
});

test("clearing a breakdown-originated chip clears the filter without navigating away from Now (FR-024)", async ({
  page,
}) => {
  await page.goto("/?tab=performance");

  await page
    .getByRole("region", { name: /breakdown by priority/i })
    .getByRole("button", { name: /P1/i })
    .click();
  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();

  await page.getByRole("button", { name: /clear filter/i }).click();

  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();
  await expect(page.locator("[data-cross-tab='true']")).toHaveCount(0);
});
