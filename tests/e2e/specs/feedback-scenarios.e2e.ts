/**
 * Feedback-disabled scenarios — verifies error surfaces remain usable without
 * exposing the upstream feedback channel.
 *
 * Covered scenarios:
 *   1. About keeps only the GEA reservation marker
 *   2. Agent test connection (CLI not found) → alert has NO feedback pill
 *   3. Agent test connection (CLI exists, ACP fails) → alert has NO feedback pill
 *      (the pill was removed from InlineAgentEditor in #3448; the unit test
 *      feedbackMountPoints.test.ts asserts the same at source level)
 *
 * Not covered here (verified via white-box unit tests instead):
 *   - MessageTips error (needs live model)
 *   - MessageToolGroup error (needs live tool call)
 *   - MessageAgentStatus error (needs broken agent session)
 */
import { test, expect, type Page } from '../fixtures';
import { goToSettings } from '../helpers';

// Label comes from i18n key settings.oneClickFeedback.
const FEEDBACK_PILL = 'button:has-text("反馈问题"), button:has-text("Report Issue")';
/** Close any open AionModal (e.g. the Agent editor) so the next test starts clean. */
async function closeAgentEditor(page: Page) {
  const closeBtn = page.locator('.arco-modal button[aria-label="Close"]').first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ timeout: 2_000 }).catch(() => {});
  }
  // Wait for modal backdrop to disappear.
  await page.waitForTimeout(300);
}

// Tests share one Electron instance across spec files; a modal left open by a
// prior (possibly failed) test intercepts pointer events and poisons every
// test after it. Close all visible modals before each test.
test.beforeEach(async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    const closeBtn = page.locator('.arco-modal-wrapper:visible button[aria-label="Close"]').first();
    if (!(await closeBtn.isVisible().catch(() => false))) break;
    await closeBtn.click({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
});

test('[1] About keeps the GEA placeholder without feedback entry', async ({ page }) => {
  await goToSettings(page, 'about');
  await expect(page.locator('[data-testid="gea-remote-services-placeholder"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(FEEDBACK_PILL)).toHaveCount(0);
  await expect(page.locator('[data-testid="feedback-report-scroll-body"]:visible')).toHaveCount(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 (MCP error → mcp-tools) is covered by the component-level test
// tests/unit/feedback/McpServerHeaderFeedback.dom.test.tsx — it renders
// McpServerHeader with status='error' and asserts the feedback pill opens
// the modal with module=mcp-tools. Driving a real MCP connection failure
// via the UI proved too brittle (locale-dependent button labels, manual-add
// vs JSON-import dropdown, auto-test timing). The component test gives
// equivalent coverage of the regression-surface.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 (System settings form error) is covered by the static mount-point
// test in tests/unit/feedback/feedbackMountPoints.test.ts — the UI path to
// trigger the error requires mocking Electron's native dialog AND cancelling
// an Arco confirm modal, which is too brittle for a stable E2E. The white-box
// source assertion verifies the module tag stays correct on refactor.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Helper: open the inline custom-agent editor and fill the command field
// ─────────────────────────────────────────────────────────────────────────────

async function openCustomAgentEditor(page: Page, command: string) {
  // Defensive: close any AionModal left over from a prior test so the
  // sidebar/page buttons are clickable.
  await closeAgentEditor(page);

  await goToSettings(page, 'agent');

  // The "Add custom Agent" entry is a TalkToButlerButton dropdown; open it and
  // choose "Add manually" to mount the inline editor modal.
  const addButton = page.locator('button:has-text("添加自定义 Agent"), button:has-text("Add Custom Agent")').first();
  await expect(addButton).toBeVisible({ timeout: 10_000 });
  await addButton.click();
  const manualItem = page.locator('.arco-dropdown-menu-item', { hasText: /手动添加|Add manually/ }).first();
  await expect(manualItem).toBeVisible({ timeout: 5_000 });
  await manualItem.click();

  // Scope everything to the editor modal — the agent cards behind it also
  // carry "测试连接" buttons, which the modal backdrop makes unclickable.
  const editorModal = page.locator('.arco-modal-wrapper', {
    has: page.locator('input[placeholder*="my-agent"]'),
  });

  // Fill the command input — target it by its placeholder (settings.commandPlaceholder)
  // so index shifts in the form don't silently fill the wrong field.
  const commandInput = editorModal.locator('input[placeholder*="my-agent"]').first();
  await expect(commandInput).toBeVisible({ timeout: 5_000 });
  await commandInput.fill(command);

  // Click "Test Connection"
  const testBtn = editorModal.locator('button:has-text("测试连接"), button:has-text("Test Connection")').first();
  await testBtn.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Agent test connection — fail_cli → agent-detection
// ─────────────────────────────────────────────────────────────────────────────

test('[2] Agent fail_cli alert shows without feedback pill', async ({ page }) => {
  await openCustomAgentEditor(page, 'aionui-e2e-missing-binary-xyz');

  // Expect the fail_cli alert to appear — without the feedback pill, which
  // was deliberately removed from InlineAgentEditor (#3448).
  const alert = page.locator('.arco-alert-error').first();
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert.locator(FEEDBACK_PILL)).toHaveCount(0);

  // Close the agent editor modal so the next test starts fresh.
  await closeAgentEditor(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Agent test connection — fail_acp → agent-detection
// ─────────────────────────────────────────────────────────────────────────────

test('[3] Agent fail_acp warning shows without feedback pill', async ({ page }) => {
  await openCustomAgentEditor(page, '/bin/echo');

  // Expect the fail_acp warning alert (warning, not error) — also without
  // the feedback pill (#3448).
  const alert = page.locator('.arco-alert-warning').first();
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert.locator(FEEDBACK_PILL)).toHaveCount(0);

  await closeAgentEditor(page);
});
