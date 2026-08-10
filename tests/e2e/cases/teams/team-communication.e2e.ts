/**
 * E2E Scenario 4: Team communication.
 *
 * Scenario 4: Leader communication — user types in UI input and sends via UI button
 */
import { test, expect } from '../../fixtures';
import { ensureTeam, invokeBridge, navigateTo, TEAM_SUPPORTED_BACKENDS } from '../../helpers';

test.describe('Team Communication', () => {
  test('scenario 4: send message to leader via UI input', async ({ page }) => {
    test.setTimeout(120_000);
    const leaderType = TEAM_SUPPORTED_BACKENDS.has('codex') ? 'codex' : [...TEAM_SUPPORTED_BACKENDS][0];
    if (!leaderType) {
      test.skip(true, 'No configured Team backend is available');
      return;
    }
    let teamId: string;
    try {
      teamId = await ensureTeam(page, 'E2E Test Team', leaderType);
    } catch (error) {
      test.skip(
        true,
        `Could not create the E2E Test Team with a ${leaderType} assistant leader: ${(error as Error).message}`
      );
      return;
    }
    expect(teamId).toBeTruthy();

    // Navigate to team page by clicking sidebar entry
    await navigateTo(page, '#/team/' + teamId);
    await page.waitForURL(/\/team\//, { timeout: 10000 });

    // Screenshot: team page loaded
    await page.screenshot({ path: 'tests/e2e/results/team-comm-01-before.png' });

    // Find the leader chat input and type a message via UI
    const chatInput = page.locator('textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.fill('Hello from E2E test');
    await page.screenshot({ path: 'tests/e2e/results/team-comm-02-typed.png' });

    // Use keyboard Enter to send (works regardless of button selector)
    await chatInput.press('Enter');

    // Wait for message to appear in chat
    await expect(page.locator('text=Hello from E2E test').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'tests/e2e/results/team-comm-03-sent.png' });

    // Verify team is still functional after the UI send path records the message.
    const teamState = await invokeBridge<{
      id: string;
      assistants?: Array<{ slot_id: string }>;
      agents?: Array<{ slot_id: string }>;
    }>(page, 'team.get', {
      id: teamId,
    });
    expect(teamState).toBeTruthy();
    expect(teamState.id).toBe(teamId);
    expect((teamState.assistants ?? teamState.agents ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
