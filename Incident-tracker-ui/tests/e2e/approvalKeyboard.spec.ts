import { test, expect } from "@playwright/test";

// A11Y-3/SC-009: full keyboard traversal of the approval queue — Tab reaches every control, Enter
// activates it, Esc closes an open modal without acting.
test("keyboard-only traversal: Tab, Enter, Esc across the approval queue", async ({ page, browserName }) => {
  // WebKit's default "Full Keyboard Access" setting excludes buttons from the Tab order — a
  // platform default Playwright's webkit engine mirrors, not an app bug (macOS Safari does this
  // too unless the user opts in via System Settings). The Tab-order assertions below only make
  // sense on engines that include buttons in the default tab order.
  test.skip(browserName === "webkit", "WebKit excludes buttons from the default Tab order");

  await page.goto("/?tab=now");

  // Set the operator name via the keyboard, same as a mouse user would need to once.
  await page.getByRole("button", { name: /set name/i }).click();
  const nameInput = page.getByRole("textbox", { name: /your name/i });
  await nameInput.focus();
  await page.keyboard.type("a.reyes");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("banner").getByText("a.reyes")).toBeVisible();

  const card = page.locator("#approval-queue li", { hasText: "Clear expired refresh-token rows" });
  const approveButton = card.getByRole("button", { name: /^approve$/i });

  await approveButton.focus();
  await expect(approveButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card.getByText(/^executing/i)).toBeVisible();

  // Esc on the HIGH-risk confirm modal cancels without approving.
  const highCard = page.locator("#approval-queue li", { hasText: "Restart the payments-db connection pool" });
  await highCard.getByRole("button", { name: /^approve$/i }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /confirm/i });
  await expect(dialog).toBeVisible();
  // useFocusTrap moves focus onto the first control the instant the modal opens.
  await expect(dialog.getByRole("button", { name: /confirm approve/i })).toBeFocused();

  // Tab cycles forward to Cancel, then wraps back to Confirm approve — proving the trap, not just
  // the initial placement.
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: /^cancel$/i })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: /confirm approve/i })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(highCard.getByText(/^executing/i)).not.toBeVisible();
  await expect(highCard.getByRole("button", { name: /^approve$/i })).toBeVisible();
});
