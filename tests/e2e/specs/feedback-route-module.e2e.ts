/**
 * The global titlebar previously exposed an upstream feedback action on every
 * route. It must stay absent until the GEA feedback contract is available.
 */
import { expect, test } from '../fixtures';
import { goToSettings, navigateTo } from '../helpers';

const FEEDBACK_ACTION = 'button[aria-label="反馈问题"], button[aria-label="Report Issue"]';

test('titlebar feedback stays absent across product routes', async ({ page }) => {
  await navigateTo(page, '#/scheduled');
  await expect(page.locator(FEEDBACK_ACTION)).toHaveCount(0);

  await navigateTo(page, '#/assistants');
  await expect(page.locator(FEEDBACK_ACTION)).toHaveCount(0);

  await goToSettings(page, 'system');
  await expect(page.locator(FEEDBACK_ACTION)).toHaveCount(0);
  await expect(page.locator('[data-testid="feedback-report-scroll-body"]:visible')).toHaveCount(0);
});
