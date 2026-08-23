import { test, expect } from "@playwright/test";

// §11.19/SC-006: a real v1 bug — resolving one card must never reset a sibling's live executing
// state. Approve two, then reject a third while the first two are still running.
test("rejecting a third card never resets the two running siblings' visible elapsed timers", async ({ page }) => {
  await page.goto("/?tab=now");
  await page.getByRole("button", { name: /set name/i }).click();
  await page.getByRole("textbox", { name: /your name/i }).fill("a.reyes");
  await page.getByRole("button", { name: /^save$/i }).click();

  const cardHigh = page.locator("#approval-queue li", { hasText: "Restart the payments-db connection pool" });
  const cardMedium = page.locator("#approval-queue li", { hasText: "Purge CDN cache" });
  const cardLow = page.locator("#approval-queue li", { hasText: "Clear expired refresh-token rows" });

  await cardHigh.getByRole("button", { name: /^approve$/i }).click();
  await page.getByRole("dialog", { name: /confirm/i }).getByRole("button", { name: /confirm approve/i }).click();
  await expect(cardHigh.getByText(/^executing/i)).toBeVisible();

  await cardLow.getByRole("button", { name: /^approve$/i }).click();
  await expect(cardLow.getByText(/^executing/i)).toBeVisible();

  const highTimerBefore = await cardHigh.getByText(/^executing/i).textContent();
  const lowTimerBefore = await cardLow.getByText(/^executing/i).textContent();

  // Reject the middle card while the other two are running.
  await cardMedium.getByRole("button", { name: /^reject$/i }).click();
  await cardMedium.getByRole("textbox", { name: /reason/i }).fill("Duplicate of another fix");
  await cardMedium.getByRole("button", { name: /submit rejection/i }).click();
  await expect(cardMedium).not.toBeVisible();

  // Both survivors are still executing — never bounced back to "Submitting approval…" or reset.
  await expect(cardHigh.getByText(/^executing/i)).toBeVisible();
  await expect(cardLow.getByText(/^executing/i)).toBeVisible();

  // Their timers kept advancing (not reset to 0s) across the sibling's removal.
  await page.waitForTimeout(2500);
  await expect
    .poll(async () => cardHigh.getByText(/^executing/i).textContent())
    .not.toBe(highTimerBefore);
  await expect
    .poll(async () => cardLow.getByText(/^executing/i).textContent())
    .not.toBe(lowTimerBefore);
});
