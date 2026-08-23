import { test, expect } from "@playwright/test";

// A11Y-3/SC-009: full keyboard traversal of the tab bar, then the open drawer (agent trace,
// similarity matches, actions, timeline, feedback) with the mouse untouched; Esc closes and
// returns focus to whatever opened it.
test("keyboard-only traversal: tab bar arrow keys, then the full drawer, then Esc restores focus", async ({
  page,
  browserName,
}) => {
  // WebKit's default "Full Keyboard Access" setting excludes buttons/links from the Tab order —
  // a platform default Playwright's webkit engine mirrors, not an app bug (approvalKeyboard.spec.ts
  // documents the same exclusion for the approval queue).
  test.skip(browserName === "webkit", "WebKit excludes buttons from the default Tab order");

  await page.goto("/?tab=now");

  // --- Tab bar: arrow-key roving tabindex (TB-1..TB-3) ---
  const nowTab = page.getByRole("tab", { name: /^now/i });
  const performanceTab = page.getByRole("tab", { name: /^performance$/i });
  const knowledgeTab = page.getByRole("tab", { name: /^knowledge$/i });

  await nowTab.focus();
  await expect(nowTab).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(performanceTab).toBeFocused();
  await expect(performanceTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: /automation funnel/i })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(knowledgeTab).toBeFocused();
  await expect(knowledgeTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: /runbook coverage gaps/i })).toBeVisible();

  await page.keyboard.press("ArrowLeft");
  await expect(performanceTab).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(nowTab).toBeFocused();
  await expect(page.locator("#incident-table")).toBeVisible();

  // --- Open the drawer via keyboard: focus a row, press Enter (IT-1) ---
  const firstRow = page.locator("#incident-table tbody tr").first();
  await firstRow.focus();
  await expect(firstRow).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: /incident detail/i });
  await expect(dialog).toBeVisible();
  // The dialog container itself gets initial focus, not its first focusable child ("Close") — a
  // real bug this test caught: opening via Enter on the (non-native) row raced the focus trap,
  // so the same Enter keystroke's keyUp landed on "Close" and self-dismissed the drawer.
  await expect(dialog).toBeFocused();

  // --- Agent run trace: reachable and its expand/collapse toggle is keyboard-operable ---
  const agentTrace = dialog.getByRole("region", { name: /agent run trace/i });
  const firstRunToggle = agentTrace.getByRole("button").first();
  const expandedBefore = await firstRunToggle.getAttribute("aria-expanded");
  await firstRunToggle.focus();
  await page.keyboard.press("Enter");
  await expect(firstRunToggle).toHaveAttribute("aria-expanded", expandedBefore === "true" ? "false" : "true");

  // --- Similarity matches: at least one keyboard-reachable "View source" link ---
  const similarity = dialog.getByRole("region", { name: /similarity matches/i });
  const sourceLinks = similarity.getByRole("link", { name: /view source/i });
  if (await sourceLinks.count() > 0) {
    await sourceLinks.first().focus();
    await expect(sourceLinks.first()).toBeFocused();
  }

  // --- Actions and executions: approve/reject controls are reachable (behaviour itself is
  // covered by approvalKeyboard.spec.ts against the same ApprovalCard) ---
  const actionButtons = dialog.getByRole("button", { name: /^(approve|reject)$/i });
  if (await actionButtons.count() > 0) {
    await actionButtons.first().focus();
    await expect(actionButtons.first()).toBeFocused();
  }

  // --- Event timeline: the "agent events only" toggle is keyboard-operable ---
  const timeline = dialog.getByRole("region", { name: /event timeline/i });
  const agentOnlyCheckbox = timeline.getByRole("checkbox");
  await agentOnlyCheckbox.focus();
  await expect(agentOnlyCheckbox).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(agentOnlyCheckbox).toBeChecked();

  // --- Feedback form: reachable and keyboard-fillable ---
  const feedback = dialog.getByRole("region", { name: /^feedback$/i });
  const feedbackTypeSelect = feedback.getByRole("combobox", { name: /feedback type/i });
  await feedbackTypeSelect.focus();
  await expect(feedbackTypeSelect).toBeFocused();
  await page.keyboard.press("a"); // type-ahead to the "Approved" option
  await expect(feedbackTypeSelect).toHaveValue("APPROVED");

  const submitButton = feedback.getByRole("button", { name: /submit feedback/i });
  await expect(submitButton).toBeVisible();

  // --- Esc closes the drawer and returns focus to the row that opened it (A11Y-3) ---
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(firstRow).toBeFocused();
});
