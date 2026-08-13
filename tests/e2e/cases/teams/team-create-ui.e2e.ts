/**
 * Case 1: Create Team - Full UI Flow
 *
 * Verifies the complete flow from Sider create button to Team page navigation.
 * No invokeBridge in core steps — all actions are real user interactions.
 * Cleanup uses invokeBridge (test data teardown is permitted).
 */
import { test, expect } from '../../fixtures';
import type { Locator } from '@playwright/test';
import {
  TEAM_SUPPORTED_BACKENDS,
  cleanupTeamsByName,
  closeTeamCreateModal,
  expandMainSidebar,
  expandTeamSection,
  openTeamCreateModal,
  pickTeamCreateAssistantOption,
} from '../../helpers';

const TEAM_NAME = 'E2E Test Team 001';

const waitForFiniteAnimations = async (locator: Locator): Promise<void> => {
  await locator.evaluate(async (element) => {
    const targets: Element[] = [];
    let current: Element | null = element;
    while (current && current !== document.body) {
      targets.push(current);
      current = current.parentElement;
    }

    const animations = new Set(targets.flatMap((target) => target.getAnimations({ subtree: true })));
    await Promise.all(
      [...animations]
        .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
        .map((animation) => animation.finished.catch(() => undefined))
    );
  });
};

test.describe('Team Create - Full UI Flow', () => {
  test.describe.configure({ timeout: 120_000 });

  test('create team via UI without any API shortcut', async ({ page }) => {
    if (TEAM_SUPPORTED_BACKENDS.size === 0) {
      test.skip();
      return;
    }

    // Step 1: Wait for Sider Teams section to appear
    await expandMainSidebar(page);
    await expect(page.locator('[data-testid="team-section-toggle"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.arco-spin-dot').first()).toBeHidden({ timeout: 15_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-ui-01-sider.png' });

    // Step 2: Click "+" create button
    const modal = await openTeamCreateModal(page);

    // Step 3: Verify modal opened
    await expect(modal.getByRole('heading', { name: /New Team|新建团队/i })).toBeVisible({ timeout: 5_000 });
    await waitForFiniteAnimations(modal);

    await page.screenshot({ path: 'tests/e2e/results/team-ui-02-modal.png' });

    // Step 4: Fill team name
    const nameInput = modal.locator('[data-testid="team-create-name-input"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(TEAM_NAME);
    await expect(nameInput).toHaveValue(TEAM_NAME);

    // Step 5: Select the first enabled assistant row
    const firstOption = await pickTeamCreateAssistantOption(
      modal,
      TEAM_SUPPORTED_BACKENDS.has('codex') ? 'codex' : undefined
    );
    if (!firstOption) {
      // No supported agents installed — cancel and skip
      await closeTeamCreateModal(modal);
      console.log('[E2E] No supported agent available for team creation — skipping');
      test.skip();
      return;
    }

    await page.screenshot({ path: 'tests/e2e/results/team-ui-03-options.png' });

    // Step 6: Select first available agent option
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    await firstOption.click();

    // Step 7: Verify Create button becomes enabled, then click
    const confirmBtn = modal.locator('.arco-btn-primary');
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-ui-04-filled.png' });

    await confirmBtn.click();

    // Step 8: Wait for navigation to /team/{id}
    await page.waitForURL(/\/team\//, { timeout: 15_000 });
    const teamId = new URL(page.url()).hash.match(/#\/team\/([^/?#]+)/)?.[1];
    if (!teamId) throw new Error(`Could not resolve the created Team id from ${page.url()}`);

    // Modal must be closed after navigation
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // The created Team must be discoverable again from the canonical sidebar,
    // not only from the Team page title.
    await expandTeamSection(page);
    const teamRow = page.locator(`[data-testid="team-sider-item-${teamId}"]`);
    await expect(teamRow).toContainText(TEAM_NAME, { timeout: 10_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-ui-05-created.png' });

    // Step 9: Verify Sider shows the new team name
    await expect(teamRow).toBeVisible({ timeout: 10_000 });

    // Step 10: Verify Tab bar with Leader agent is visible
    const tabBar = page.locator('[data-testid="team-tab-bar"]');
    await expect(tabBar).toBeVisible({ timeout: 10_000 });

    // At least one tab (the Leader) must exist
    const tabs = tabBar.locator('> div');
    await expect(tabs.first()).toBeVisible({ timeout: 5_000 });

    // Creation is not complete until the selected member runtime is actually
    // usable. A navigation-only assertion used to pass while the page showed a
    // failed warmup overlay.
    await expect(page.locator('[data-testid="team-warmup-overlay"]')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('[data-testid="team-warmup-error"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sendbox-input"]').first()).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-ui-06-team-page.png' });

    // Cleanup: remove the team via IPC (test data teardown only)
    await cleanupTeamsByName(page, TEAM_NAME);
  });
});
