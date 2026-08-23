import { test, expect } from "@playwright/test";

// FR-017/FR-059, §11.7/§11.18, SC-010: the drawer is addressable state, not session state — a
// direct URL load and a reload must both land with it already open.
test("opening ?tab=now&incident=<id> directly opens the drawer, and it survives a reload", async ({ page }) => {
  await page.goto("/?tab=now&incident=inc-1042");

  const dialog = page.getByRole("dialog", { name: /incident detail/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Connection pool exhausted on payments-db" })).toBeVisible();

  await page.reload();

  const dialogAfterReload = page.getByRole("dialog", { name: /incident detail/i });
  await expect(dialogAfterReload).toBeVisible();
  await expect(
    dialogAfterReload.getByRole("heading", { name: "Connection pool exhausted on payments-db" }),
  ).toBeVisible();
});
