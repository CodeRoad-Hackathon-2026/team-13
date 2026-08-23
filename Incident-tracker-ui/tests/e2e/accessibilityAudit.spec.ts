import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// A11Y-2/FR-112: automated WCAG AA check across every pill/badge/chart series on each tab and the
// open drawer. Runs the full ruleset (not just color-contrast) restricted to WCAG 2/2.1 A+AA tags.
async function auditPage(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
}

test("Now tab has no WCAG AA violations", async ({ page }) => {
  await page.goto("/?tab=now");
  await expect(page.locator("#incident-table")).toBeVisible();
  const results = await auditPage(page);
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("Performance tab has no WCAG AA violations", async ({ page }) => {
  await page.goto("/?tab=performance");
  await expect(page.getByRole("region", { name: /automation funnel/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /incident volume/i })).toBeVisible();
  const results = await auditPage(page);
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("Agent tab has no WCAG AA violations", async ({ page }) => {
  await page.goto("/?tab=agent");
  // The roster and the selected agent's own cards — the segmented controls and
  // switches are what this audit is here for.
  await expect(page.getByRole("region", { name: /^agents$/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /autonomy level/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /guardrails/i })).toBeVisible();
  const results = await auditPage(page);
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("Knowledge tab has no WCAG AA violations", async ({ page }) => {
  await page.goto("/?tab=knowledge");
  await expect(page.getByRole("region", { name: /runbook coverage gaps/i })).toBeVisible();
  const results = await auditPage(page);
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("the open incident drawer has no WCAG AA violations", async ({ page }) => {
  await page.goto("/?tab=now");
  await page.locator("#incident-table tbody tr").first().click();
  await expect(page.getByRole("dialog", { name: /incident detail/i })).toBeVisible();
  const results = await auditPage(page);
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
