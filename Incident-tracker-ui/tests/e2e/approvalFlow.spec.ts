import { test, expect } from "@playwright/test";

// SC-001/SC-006/SC-007, FR-011/FR-047: the full human-in-the-loop gate, and reaching the queue
// from a tab other than Now via the alert strip's own button.
test.describe("approval flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?tab=now");
    // FR-121: set the operator name via the header control, so later clicks approve/reject for
    // real rather than the first click going to the FR-120 name prompt as a side effect.
    await page.getByRole("button", { name: /set name/i }).click();
    await page.getByRole("textbox", { name: /your name/i }).fill("a.reyes");
    await page.getByRole("button", { name: /^save$/i }).click();
  });

  test("approves a LOW-risk action in a single click, with no confirmation modal", async ({ page }) => {
    const card = page.locator("#approval-queue li", { hasText: "Clear expired refresh-token rows" });
    await card.getByRole("button", { name: /^approve$/i }).click();

    await expect(page.getByRole("dialog", { name: /confirm/i })).not.toBeVisible();
    await expect(card.getByText(/^executing/i)).toBeVisible();
  });

  test("approves a HIGH-risk action only through the confirm modal", async ({ page }) => {
    const card = page.locator("#approval-queue li", { hasText: "Restart the payments-db connection pool" });
    await card.getByRole("button", { name: /^approve$/i }).click();

    const dialog = page.getByRole("dialog", { name: /confirm/i });
    await expect(dialog).toBeVisible();
    await expect(card.getByText(/^executing/i)).not.toBeVisible();

    await dialog.getByRole("button", { name: /confirm approve/i }).click();
    await expect(card.getByText(/^executing/i)).toBeVisible();
  });

  test("refuses a reject with no reason, then succeeds once one is given (FR-038)", async ({ page }) => {
    const card = page.locator("#approval-queue li", { hasText: "Purge CDN cache" });
    await card.getByRole("button", { name: /^reject$/i }).click();
    await card.getByRole("button", { name: /submit rejection/i }).click();

    await expect(card.getByRole("alert")).toHaveText(/reason is required/i);

    await card.getByRole("textbox", { name: /reason/i }).fill("No longer necessary");
    await card.getByRole("button", { name: /submit rejection/i }).click();

    await expect(card).not.toBeVisible();
  });

  test("reaches the approval queue from the Performance tab via the alert strip", async ({ page }) => {
    await page.getByRole("tab", { name: /^performance$/i }).click();
    await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeHidden();

    await page.getByRole("button", { name: /awaiting approval/i }).click();

    await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();
    await expect(page.locator("#approval-queue")).toHaveAttribute("data-flash", "true");
  });
});
