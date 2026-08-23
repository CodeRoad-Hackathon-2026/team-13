import { test, expect } from "@playwright/test";

// T191: quickstart.md's 11-step manual golden-path check, driven end-to-end instead of by hand.
// Most steps are already covered individually by other specs (triage/approvalFlow/deepLink/
// funnelReconciliation/knowledgeView/drawerKeyboard/tabSwitchNoRefetch/siblingCardSurvival) — this
// walks the SAME sequence a human would, in the SAME order, as the one check that exercises the
// full path end-to-end rather than each piece in isolation.
test("quickstart.md golden path, steps 1-11", async ({ page }) => {
  // 1. Alert strip renders hot/warm; Now tab selected by default.
  await page.goto("/");
  const strip = page.getByRole("status");
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute("data-severity", /hot|warm/);
  await expect(page.getByRole("tab", { name: /^now/i })).toHaveAttribute("aria-selected", "true");

  // Prerequisite for steps 4-6/8's approve/reject/feedback actions: set the operator name via the
  // header control (FR-121), so those clicks act for real rather than surfacing the FR-120 name
  // prompt first.
  await page.getByRole("button", { name: /set name/i }).click();
  await page.getByRole("textbox", { name: /your name/i }).fill("a.reyes");
  await page.getByRole("button", { name: /^save$/i }).click();

  // 2. Four Now tiles render before any chart; "Unassigned" filters the table with a matching count.
  const unassignedTile = page.getByRole("button", { name: /unassigned/i });
  await expect(unassignedTile).toBeVisible();
  // KpiTile.tsx: label+delta share the first <div>, the bare value is the tile's own second <div>.
  const expectedCount = Number((await unassignedTile.locator("div").nth(1).textContent()) ?? "-1");
  await unassignedTile.click();
  await expect(page).toHaveURL(/filterKind=kpiTile/);
  await expect(page.getByText(new RegExp(`showing ${expectedCount} of ${expectedCount}`, "i"))).toBeVisible();
  await page.getByRole("button", { name: /clear filter/i }).click();

  // 3. Switching Now -> Performance -> Knowledge -> Now never changes the strip's counts, no skeleton.
  const stripTextBefore = await strip.textContent();
  await page.getByRole("tab", { name: /^performance$/i }).click();
  await expect(page.getByRole("region", { name: /automation funnel/i })).toBeVisible();
  await page.getByRole("tab", { name: /^knowledge$/i }).click();
  await expect(page.getByRole("region", { name: /runbook coverage gaps/i })).toBeVisible();
  await page.getByRole("tab", { name: /^now/i }).click();
  await expect(strip).toHaveText(stripTextBefore ?? "");
  await expect(page.getByText(/loading/i)).toHaveCount(0);

  // 4/5/6. Approve LOW in one click; HIGH needs the confirm modal; reject requires a reason.
  const lowCard = page.locator("#approval-queue li", { hasText: "Clear expired refresh-token rows" });
  await lowCard.getByRole("button", { name: /^approve$/i }).click();
  await expect(lowCard.getByText(/^executing/i)).toBeVisible();

  const highCard = page.locator("#approval-queue li", { hasText: "Restart the payments-db connection pool" });
  await highCard.getByRole("button", { name: /^approve$/i }).click();
  const confirmDialog = page.getByRole("dialog", { name: /confirm/i });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: /confirm approve/i }).click();
  await expect(highCard.getByText(/^executing/i)).toBeVisible();

  const mediumCard = page.locator("#approval-queue li", { hasText: "Purge CDN cache" });
  await mediumCard.getByRole("button", { name: /^reject$/i }).click();
  await mediumCard.getByRole("button", { name: /submit rejection/i }).click();
  await expect(mediumCard.getByRole("alert")).toBeVisible(); // refused with no reason
  await mediumCard.getByLabel(/reason/i).fill("Duplicate of an already-approved action");
  await mediumCard.getByRole("button", { name: /submit rejection/i }).click();
  await expect(mediumCard).not.toBeVisible(); // rejected cards leave the queue entirely (§11.19)

  // 7. Row click opens the drawer, deep-linked; reload restores the same tab and incident.
  const firstRow = page.locator("#incident-table tbody tr").first();
  // The title <td>'s own `title` attribute holds the clean title, without the source-abbreviation
  // span (e.g. "PD") IncidentRow.tsx prepends to its visible text content.
  const incidentTitle = await firstRow.locator("td").nth(2).getAttribute("title");
  await firstRow.click();
  const dialog = page.getByRole("dialog", { name: /incident detail/i });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/incident=/);
  await page.reload();
  await expect(page.getByRole("dialog", { name: /incident detail/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: incidentTitle ?? "" })).toBeVisible();

  // 8. A FAILED agent run starts expanded; everything else starts collapsed.
  const agentTrace = page.getByRole("region", { name: /agent run trace/i });
  const failedRun = agentTrace.locator("li[data-error='true']").first();
  if (await failedRun.count() > 0) {
    await expect(failedRun.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  }
  const okRun = agentTrace.locator("li[data-error='false']").first();
  if (await okRun.count() > 0) {
    await expect(okRun.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  }
  await page.getByRole("button", { name: /close incident detail/i }).click();
  await expect(dialog).not.toBeVisible();

  // 9. A Performance funnel-stage click jumps to Now, flashes, chips, toasts, and matches the drop
  // count; clearing the chip stays on Now.
  await page.getByRole("tab", { name: /^performance$/i }).click();
  const ragMatchedRow = page.getByRole("button", { name: /rag match found/i });
  await expect(ragMatchedRow).toContainText("−44");
  await ragMatchedRow.click();
  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();
  await expect(page.locator("#incident-table")).toHaveAttribute("data-flash", "true");
  await expect(page.locator("[data-cross-tab='true']").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /jumped to now/i })).toBeVisible();
  await expect(page.getByText(/showing \d+ of 44/i)).toBeVisible();
  await page.getByRole("button", { name: /clear filter/i }).click();
  await expect(page.getByRole("tabpanel", { name: /^now$/i })).toBeVisible();

  // 10. Knowledge's coverage-gap chart is sorted worst-first with a highest-leverage-fix caption;
  // a documentation-candidate row opens the drawer the same way an incident row does.
  await page.getByRole("tab", { name: /^knowledge$/i }).click();
  const coverageGaps = page.getByRole("region", { name: /runbook coverage gaps/i });
  await expect(coverageGaps.locator("p").first()).toBeVisible();
  const candidateSection = page.getByRole("region", { name: /documentation candidates/i });
  if ((await candidateSection.locator("tbody tr, li").count()) > 0) {
    await candidateSection.locator("tbody tr, li").first().click();
    await expect(page.getByRole("dialog", { name: /incident detail/i })).toBeVisible();
    await page.getByRole("button", { name: /close incident detail/i }).click();
  }

  // 11. Tab bar arrow-key navigation, then keyboard-only queue/drawer traversal (covered fully by
  // drawerKeyboard.spec.ts and approvalKeyboard.spec.ts — spot-checked here for the golden path).
  await page.getByRole("tab", { name: /^now/i }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^performance$/i })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: /^now/i })).toBeFocused();
});
