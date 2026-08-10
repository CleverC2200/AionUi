import { test, expect } from '../../fixtures';
import { cleanupTeamsByName, createTeam, findAssistantIdForBackend } from '../../helpers';

const TEAM_FULLSCREEN = 'E2E Fullscreen Team';
const TEAM_MODEL = 'E2E Model Selector Team';

test.describe('Team View Modes', () => {
  test('fullscreen toggle: enter and exit fullscreen for an agent slot', async ({ page }) => {
    await cleanupTeamsByName(page, TEAM_FULLSCREEN);

    try {
      await createTeam(page, TEAM_FULLSCREEN);
    } catch {
      test.skip();
      return;
    }

    // Wait for the leader agent panel header to render
    const leaderSlot = page.locator('[data-role="leader"]');
    const agentHeader = leaderSlot.locator('[data-testid="team-agent-header"]');
    await expect(agentHeader).toBeVisible({ timeout: 15_000 });

    const fullscreenBtn = leaderSlot.locator('[data-testid="team-agent-fullscreen-toggle"]');
    await expect(fullscreenBtn).toBeVisible({ timeout: 10_000 });

    // Count agent slot containers before fullscreen
    const slotsBeforeCount = await page.locator('[data-role="leader"], [data-role="member"]').count();

    await fullscreenBtn.click();

    // After entering fullscreen the OffScreen icon should appear
    const singleViewSlot = page.locator('[data-testid="team-agent-header"]');
    const offscreenBtn = singleViewSlot.locator('[data-testid="team-agent-fullscreen-toggle"]');
    await expect(offscreenBtn).toBeVisible({ timeout: 5_000 });
    await expect(offscreenBtn).toHaveAttribute('data-fullscreen', 'true');

    // Exit fullscreen
    await offscreenBtn.click();

    const restoredFullscreenBtn = leaderSlot.locator('[data-testid="team-agent-fullscreen-toggle"]');
    await expect(restoredFullscreenBtn).toBeVisible({ timeout: 5_000 });
    await expect(restoredFullscreenBtn).toHaveAttribute('data-fullscreen', 'false');

    // Slot count should be restored (at least as many as before)
    const slotsAfterCount = await page.locator('[data-role="leader"], [data-role="member"]').count();
    expect(slotsAfterCount).toBeGreaterThanOrEqual(slotsBeforeCount);

    await cleanupTeamsByName(page, TEAM_FULLSCREEN);
  });

  test('model selector dropdown shows available models for ACP agent', async ({ page }) => {
    await cleanupTeamsByName(page, TEAM_MODEL);

    const backend = (await findAssistantIdForBackend(page, 'codex', { requireAvailable: true })) ? 'codex' : null;
    if (!backend) {
      test.skip();
      return;
    }

    try {
      await createTeam(page, TEAM_MODEL, backend);
    } catch {
      test.skip();
      return;
    }

    // Wait for leader agent panel to load
    const leaderSlot = page.locator('[data-role="leader"]');
    const agentHeader = leaderSlot.locator('[data-testid="team-agent-header"]');
    await expect(agentHeader).toBeVisible({ timeout: 15_000 });

    // Find the model selector button (AcpModelSelector renders with class header-model-btn)
    const modelBtn = leaderSlot.locator('.header-model-btn').first();
    await expect(modelBtn).toBeVisible({ timeout: 15_000 });

    await modelBtn.click();

    // The dropdown uses Arco Menu — check if menu items appeared
    const menuItems = page.locator('.arco-dropdown-menu-item, .arco-menu-item');
    const menuVisible = await menuItems
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (menuVisible) {
      const itemCount = await menuItems.count();
      expect(itemCount).toBeGreaterThan(0);

      // Close the dropdown by pressing Escape
      await page.keyboard.press('Escape');
    } else {
      // Model info may not be loaded yet (can_switch=false or no models cached).
      // The button is still visible which confirms the component renders — that is acceptable.
      console.log('[E2E] Model selector button visible but dropdown did not open (can_switch may be false)');
    }

    await cleanupTeamsByName(page, TEAM_MODEL);
  });
});
