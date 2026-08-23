import { test, expect } from "@playwright/test";

// SC-004/FR-101/K2: a runbook owner must be able to state the single highest-leverage fix without
// additional inference — the caption has to name it explicitly, not leave the reader to read a
// chart and work it out.
test("a runbook owner reads the coverage-gap caption and can state the highest-leverage fix directly", async ({
  page,
}) => {
  await page.goto("/?tab=knowledge");

  const coverageGaps = page.getByRole("region", { name: /runbook coverage gaps/i });
  await expect(coverageGaps).toBeVisible();

  // The worst service (lowest known-incident rate) is named explicitly in prose.
  const caption = coverageGaps.getByText(/fixing .+ would move the funnel more than any model change/i);
  await expect(caption).toBeVisible();

  // It's genuinely the worst one — first in the ascending, worst-first list — not an arbitrary pick.
  const rows = coverageGaps.getByRole("listitem");
  const firstRowText = await rows.first().textContent();
  const captionText = await caption.textContent();
  const namedService = captionText?.match(/Fixing (\S+) would/)?.[1];
  expect(namedService).toBeTruthy();
  expect(firstRowText).toContain(namedService);
});

test("the three Knowledge tiles, documents-driving-resolutions ranking, and documentation candidates all render", async ({
  page,
}) => {
  await page.goto("/?tab=knowledge");

  await expect(page.getByText("Knowledge documents")).toBeVisible();
  await expect(page.getByText("Services with a runbook")).toBeVisible();
  await expect(page.getByText("Undocumented resolutions")).toBeVisible();

  const documents = page.getByRole("region", { name: /documents driving resolutions/i });
  await expect(documents.getByRole("listitem").first()).toBeVisible();

  const candidates = page.getByRole("region", { name: /documentation candidates/i });
  await expect(candidates).toBeVisible();
});
