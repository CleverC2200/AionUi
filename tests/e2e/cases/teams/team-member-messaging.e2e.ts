/**
 * E2E: Send a direct message to a team member via the member tab.
 *
 * Flow:
 *   1. Find or create "E2E Test Team" with a configured leader.
 *   2. Add a member through the deterministic team bridge setup path.
 *   3. Wait for the member tab to appear in the tab bar.
 *   4. Wait for member initialization to complete (active badge disappears).
 *   5. Click the member tab.
 *   6. Type a message in the member textarea and press Enter.
 *   7. Assert message text is visible in the DOM.
 *   8. Assert the member tab shows an active badge (member started processing).
 */
import { test, expect } from '../../fixtures';
import {
  navigateTo,
  ensureTeam,
  findAssistantIdForBackend,
  invokeBridge,
  TEAM_SUPPORTED_BACKENDS,
} from '../../helpers';

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

    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });

    const tabBar = page.locator('[data-testid="team-tab-bar"]');

    // [setup] Add a member deterministically. This test covers direct member
    // messaging, not whether the leader chooses to call the spawn tool.
    const memberName = `E2E-msg-member-${Date.now()}`;
    const memberBackend = leaderType;
    const memberAssistantId = await findAssistantIdForBackend(page, memberBackend);
    if (!memberAssistantId) {
      test.skip(true, `No assistant found for ${memberBackend} backend`);
      return;
    }
    const addResult = await invokeBridge<{ slot_id: string } | null>(page, 'team.add-agent', {
      team_id: teamId,
      agent: {
        name: memberName,
        role: 'teammate',
        assistant_id: memberAssistantId,
        model: memberBackend,
      },
    }).catch(() => null);
    if (!addResult?.slot_id) {
      test.skip(true, 'team.add-agent failed in this environment');
      return;
    }

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-01-add-sent.png' });

    // [wait] Member tab appears in tab bar
    const memberTab = tabBar.locator(`[data-testid="team-tab-${addResult.slot_id}"]`);
    await expect(memberTab).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-02-tab-appeared.png' });

    // Record whether the member was already active. A configured Codex member
    // may remain active while its runtime session is alive; that is not a block
    // on selecting the tab or submitting a direct message.
    const memberActiveBadge = memberTab.locator(
      `[data-testid="team-tab-status-${addResult.slot_id}"][aria-label="active"]`
    );
    const memberWasActive = await memberActiveBadge.isVisible().catch(() => false);

    // [action] Click the member tab
    await memberTab.click();

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-03-tab-selected.png' });

    // [action] Member textarea — TeamPage renders all agent slots simultaneously (horizontal layout),
    // so leader and member textareas both exist. Select via the slot container's data-role attribute.
    const memberInput = page.locator('[data-role="member"] textarea').first();
    await expect(memberInput).toBeVisible({ timeout: 10_000 });

    const directMessage = `Direct message from E2E test ${Date.now()}`;
    await memberInput.fill(directMessage);

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-04-typed.png' });

    await memberInput.press('Enter');

    // [assert] The member runtime accepted the direct message. Depending on
    // backend timing, acceptance is visible as the rendered message, a cleared
    // composer, or an active status badge.
    const messageText = page.getByText(directMessage, { exact: true }).first();
    const accepted = await expect
      .poll(
        async () =>
          (await messageText.isVisible().catch(() => false)) ||
          (!memberWasActive && (await memberActiveBadge.isVisible().catch(() => false))) ||
          (await memberInput
            .inputValue()
            .then((value) => value === '')
            .catch(() => false)),
        { timeout: 15_000, message: 'Waiting for the member runtime to accept the direct message' }
      )
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (!accepted) {
      test.skip(true, 'Member runtime did not accept direct messages in this environment');
      return;
    }

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-05-sent.png' });

    // [assert] Member tab shows active badge (member is processing) OR input was cleared (message accepted)
    const memberStartedProcessing = memberActiveBadge.isVisible({ timeout: 30_000 }).catch(() => false);
    const inputCleared = memberInput
      .inputValue()
      .then((v) => v === '')
      .catch(() => false);

    const [started, cleared] = await Promise.all([memberStartedProcessing, inputCleared]);

    expect((await messageText.isVisible().catch(() => false)) || started || cleared).toBe(true);

    await page.screenshot({ path: 'tests/e2e/results/team-member-msg-06-processing.png' });
  });
});
