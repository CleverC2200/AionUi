/**
 * E2E Scenario 1: Create a team from the sidebar.
 *
 * Flow: sidebar "+" button -> Create Team modal -> fill form -> create -> verify navigation
 */
import { test, expect } from '../../fixtures';
import {
  TEAM_SUPPORTED_BACKENDS,
  cleanupTeamsByName,
  closeTeamCreateModal,
  openTeamCreateModal,
  pickTeamCreateAssistantOption,
} from '../../helpers';

test.describe('Team Create', () => {
  test('sidebar shows team section with create button', async ({ page }) => {
    // Wait for sidebar to render — no fixed timeout, listen for element
    await expect(page.locator('[data-testid="team-section-toggle"]')).toBeVisible({ timeout: 15000 });

    // Screenshot: initial state
    await page.screenshot({ path: 'tests/e2e/results/team-01-initial.png' });

    // Verify the "+" create button exists next to the Teams title
    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible();
  });

  test('clicking + opens create team modal', async ({ page }) => {
    // Wait for create button to be ready before clicking
    let modal = await openTeamCreateModal(page);

    // The shared Electron window may retain a modal from a prior test. Opening
    // the flow again must recover to exactly one fresh, interactive modal.
    modal = await openTeamCreateModal(page);
    await expect(page.locator('.team-create-modal:visible')).toHaveCount(1);

    // Screenshot: modal open
    await page.screenshot({ path: 'tests/e2e/results/team-02-modal.png' });

    // Verify Modal is visible with "Create Team" title
    await expect(modal.getByRole('heading', { name: /New Team|新建团队/i })).toBeVisible({ timeout: 5000 });

    // Verify Team name input exists
    const nameInput = modal.locator('[data-testid="team-create-name-input"]');
    await expect(nameInput).toBeVisible();

    // Verify assistant leader choices render, or the empty-state appears.
    const leaderOptions = modal.locator('[data-testid^="team-create-agent-option-"]');
    const noAssistantsMsg = modal.getByText(/No supported assistants available|没有支持的助手/i);
    const hasOptions = await leaderOptions
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    const hasNoAssistantsMsg = await noAssistantsMsg.isVisible({ timeout: 1000 }).catch(() => false);
    expect(hasOptions || hasNoAssistantsMsg).toBeTruthy();

    // Verify Create button exists (disabled until agent is selected and name is filled)
    const confirmBtn = modal.locator('.arco-btn-primary');
    await expect(confirmBtn).toBeVisible();

    // Close modal via the standard header close button
    await closeTeamCreateModal(modal);
  });

  test('can fill form and create team', async ({ page }) => {
    // Wait for create button to be ready before clicking
    const modal = await openTeamCreateModal(page);

    // Fill team name
    const nameInput = modal.locator('[data-testid="team-create-name-input"]');
    await nameInput.fill('E2E Test Team');

    const firstOption = await pickTeamCreateAssistantOption(modal);

    await page.screenshot({ path: 'tests/e2e/results/team-03-assistant-list.png' });

    if (firstOption) {
      await expect(firstOption).toBeVisible({ timeout: 5000 });
      await firstOption.click();

      // Wait for select value to reflect the chosen option (Create btn becomes enabled)
      const confirmBtn = modal.locator('.arco-btn-primary');
      await expect(confirmBtn).toBeEnabled({ timeout: 5000 });

      // Screenshot: form filled
      await page.screenshot({ path: 'tests/e2e/results/team-04-filled.png' });

      // Click Create and wait for navigation
      await confirmBtn.click();
      await page.waitForURL(/\/team\//, { timeout: 15000 });

      // Screenshot: after creation
      await page.screenshot({ path: 'tests/e2e/results/team-05-created.png' });

      // Verify team name appears in sidebar
      const teamName = page.locator('text=E2E Test Team');
      await expect(teamName.first()).toBeVisible({ timeout: 10000 });

      // cleanup: remove the team we just created to avoid polluting later tests
      await cleanupTeamsByName(page, 'E2E Test Team');
    } else {
      // No supported agents installed — screenshot and skip
      await page.screenshot({ path: 'tests/e2e/results/team-03-no-assistants.png' });
      console.log('[E2E] No supported assistants available for team creation');
      await closeTeamCreateModal(modal);
      test.skip();
    }
  });
});

/**
 * Helper: open the Create Team modal, fill a team name, select the assistant
 * whose option text matches `agentTextPattern`, click Create, and verify the
 * team was created. Skips gracefully if the assistant is unavailable.
 */
async function createTeamWithAgent(
  page: import('@playwright/test').Page,
  teamName: string,
  backend: string,
  screenshotPrefix: string
): Promise<void> {
  const modal = await openTeamCreateModal(page);

  // Fill team name
  const nameInput = modal.locator('[data-testid="team-create-name-input"]');
  await nameInput.fill(teamName);

  await page.screenshot({ path: `tests/e2e/results/${screenshotPrefix}-assistant-list.png` });

  // Find the assistant option matching the text pattern.
  const matchingOption = await pickTeamCreateAssistantOption(modal, backend);

  if (!matchingOption) {
    await closeTeamCreateModal(modal);
    console.log(`[E2E] Assistant matching ${backend} not found — skipping`);
    test.skip();
    return;
  }

  await matchingOption.click();

  // Wait for Create button to become enabled (select value applied)
  const confirmBtn = page.locator('.arco-modal .arco-btn-primary');
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });

  await page.screenshot({ path: `tests/e2e/results/${screenshotPrefix}-filled.png` });

  // Submit and wait for navigation
  await confirmBtn.click();
  await page.waitForURL(/\/team\//, { timeout: 15000 });

  await page.screenshot({ path: `tests/e2e/results/${screenshotPrefix}-created.png` });

  // Verify team name appears in sidebar
  const teamNameLocator = page.locator(`text=${teamName}`);
  await expect(teamNameLocator.first()).toBeVisible({ timeout: 10000 });

  // cleanup: remove the team we just created to avoid polluting later tests
  await cleanupTeamsByName(page, teamName);
}

test.describe('Team Create - whitelisted leader types', () => {
  for (const backend of TEAM_SUPPORTED_BACKENDS) {
    test(`create E2E Team (${backend})`, async ({ page }) => {
      await createTeamWithAgent(page, `E2E Team (${backend})`, backend, `team-${backend}`);
    });
  }
});
