/**
 * E2E: Send a direct message to a team member via the member tab.
 *
 * Flow:
 *   1. Find or create "E2E Test Team" with a configured leader.
 *   2. Add a configured member through the Team tab UI.
 *   3. Wait for the member tab to appear and select it.
 *   4. Type a message in the member textarea and press Enter.
 *   5. Assert message text is visible in the DOM.
 */
import { test, expect } from '../../fixtures';
import { navigateTo, ensureTeam, findAssistantIdForBackend, TEAM_SUPPORTED_BACKENDS } from '../../helpers';

test.describe('Team Member Messaging', () => {
  test('send message directly to member via member tab', async ({ page }) => {
    test.setTimeout(300_000);

    // [setup] Resolve a configured leader type — prefer Codex for direct messaging.
    const leaderType = TEAM_SUPPORTED_BACKENDS.has('codex') ? 'codex' : [...TEAM_SUPPORTED_BACKENDS][0];

    if (!leaderType) {
      test.skip(true, 'No supported backend available — skipping member messaging test');
      return;
    }

    // [setup] Find or create the team (ensureTeam handles find-or-create)
    let teamId: string;
    try {
      teamId = await ensureTeam(page, 'E2E Test Team', leaderType);
    } catch {
      test.skip(true, `Team could not be created with backend "${leaderType}" — agent may not be installed`);
      return;
    }

    // [navigate] Go to team page and wait for leader chat input
    await navigateTo(page, '#/team/' + teamId);
    await page.waitForURL(/\/team\//, { timeout: 10_000 });

    const leaderInput = page.locator('[data-role="leader"] textarea').first();
    await expect(leaderInput).toBeVisible({ timeout: 10_000 });
    await expect(leaderInput).toBeEnabled({ timeout: 120_000 });

    const tabBar = page.locator('[data-testid="team-tab-bar"]');

    // [setup] Add a configured member through the same UI path a user follows.
    const memberBackend =
      leaderType === 'codex' && TEAM_SUPPORTED_BACKENDS.has('aionrs')
        ? 'aionrs'
        : leaderType === 'aionrs' && TEAM_SUPPORTED_BACKENDS.has('codex')
          ? 'codex'
          : leaderType;
    const memberAssistantId = await findAssistantIdForBackend(page, memberBackend);
    if (!memberAssistantId) {
      test.skip(true, `No assistant found for ${memberBackend} backend`);
      return;
    }
    const memberTabs = tabBar.locator('[data-team-tab-role="teammate"]');
    const existingMemberCount = await memberTabs.count();

    const addMemberButton = tabBar.locator('[data-testid="team-tab-add-member"]');
    await expect(addMemberButton).toBeEnabled({ timeout: 60_000 });
    await addMemberButton.click();

    const addMemberPanel = page.locator('[data-testid="team-add-member-panel"]');
    await expect(addMemberPanel).toBeVisible({ timeout: 5_000 });
    const memberOption = addMemberPanel.locator(`[data-testid="team-add-member-option-${memberAssistantId}"]`);
    await expect(memberOption).toBeEnabled({ timeout: 5_000 });
    await memberOption.click();

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-01-add-sent.png' });

    // [wait] Member tab appears in tab bar
    await expect(memberTabs).toHaveCount(existingMemberCount + 1, { timeout: 120_000 });
    const memberTab = memberTabs.last();
    await expect(memberTab).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-02-tab-appeared.png' });

    // [action] Click the member tab
    await memberTab.click();

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-03-tab-selected.png' });

    // [action] Member textarea — TeamPage renders all agent slots simultaneously (horizontal layout),
    // so leader and member textareas both exist. Select via the slot container's data-role attribute.
    const memberSlot = page.locator('[data-role="member"]').first();
    const memberInput = memberSlot.locator('textarea').first();
    await expect(memberInput).toBeVisible({ timeout: 10_000 });

    const directMessage = `Direct message from E2E test ${Date.now()}`;
    await memberInput.fill(directMessage);

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-04-typed.png' });

    await memberInput.press('Enter');

    // [assert] The direct message is rendered in the selected member conversation.
    const messageText = memberSlot.getByText(directMessage, { exact: true }).filter({ visible: true });
    await expect(messageText).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-05-sent.png' });

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-06-processing.png' });
  });
});
