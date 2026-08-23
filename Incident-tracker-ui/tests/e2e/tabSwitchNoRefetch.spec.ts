import { test, expect } from "@playwright/test";

// TB-4/FR-019: panels stay mounted once loaded — switching tabs toggles visibility only, it never
// re-triggers the query or re-shows the skeleton for content that already loaded.
test("switching between tabs after initial load triggers no additional network request or skeleton for already-loaded panels", async ({
  page,
}) => {
  const dashboardRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/dashboard/") || url.pathname === "/api/incidents") {
      dashboardRequests.push(url.pathname);
    }
  });

  await page.goto("/?tab=now");
  await expect(page.locator("#incident-table")).toBeVisible();
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  // First visit to each tab — a real load is expected and allowed here.
  await page.getByRole("tab", { name: /performance/i }).click();
  await expect(page.getByRole("region", { name: /automation funnel/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /incident volume/i })).toBeVisible();
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  await page.getByRole("tab", { name: /^agent$/i }).click();
  await expect(page.getByRole("region", { name: /^agents$/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /autonomy level/i })).toBeVisible();
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  await page.getByRole("tab", { name: /knowledge/i }).click();
  await expect(page.getByRole("region", { name: /runbook coverage gaps/i })).toBeVisible();
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  const requestCountAfterFirstPass = dashboardRequests.length;

  // Second pass: revisiting each tab must not re-fetch or re-skeleton anything already loaded.
  await page.getByRole("tab", { name: /^now/i }).click();
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  await page.getByRole("tab", { name: /performance/i }).click();
  await expect(page.getByRole("region", { name: /automation funnel/i })).toBeVisible();
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  await page.getByRole("tab", { name: /^agent$/i }).click();
  await expect(page.getByRole("region", { name: /^agents$/i })).toBeVisible();
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  await page.getByRole("tab", { name: /knowledge/i }).click();
  await expect(page.getByRole("region", { name: /runbook coverage gaps/i })).toBeVisible();
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  await page.getByRole("tab", { name: /^now/i }).click();
  await expect(page.locator("#incident-table")).toBeVisible();

  expect(dashboardRequests.length).toBe(requestCountAfterFirstPass);
});
