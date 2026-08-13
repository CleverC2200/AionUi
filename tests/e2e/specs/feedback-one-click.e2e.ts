/**
 * GEA-managed remote services are intentionally unavailable in this release.
 * Verify that the About page keeps a neutral reservation marker without
 * exposing the upstream update, feedback, or external-link actions.
 */
import { expect, test } from '../fixtures';
import { goToSettings } from '../helpers';

test.describe('GEA remote services placeholder', () => {
  test('About exposes no official update or feedback action', async ({ page }) => {
    await goToSettings(page, 'about');

    const placeholder = page.locator('[data-testid="gea-remote-services-placeholder"]');
    await expect(placeholder).toBeVisible({ timeout: 10_000 });
    await expect(placeholder).toContainText(/GEA/);
    await expect(placeholder).toContainText(/即将上线|Coming Soon/i);

    await expect(page.locator('button', { hasText: /检查更新|Check for Updates/i })).toHaveCount(0);
    await expect(page.locator('text=/反馈问题|Report Issue/i')).toHaveCount(0);
    await expect(page.locator('[data-testid="feedback-report-scroll-body"]:visible')).toHaveCount(0);
    await expect(page.locator('a')).toHaveCount(0);
  });
});
