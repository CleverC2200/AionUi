/**
 * Skills Hub E2E Tests - Edge Cases (P2 Priority)
 *
 * Test Cases Covered:
 * - TC-S-23: URL parameter highlight skill (skill doesn't exist scenario)
 */

import { test, expect } from '../../../fixtures';
import { goToSkillsHub, cleanupTestSkills } from '../../../helpers/skillsHub';
import { takeScreenshot } from '../../../helpers/screenshots';

test.describe('Skills Hub - Edge Cases (P2)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('TC-S-23: should not crash when URL highlight param references non-existent skill', async ({ page }) => {
    await takeScreenshot(page, 'skills-hub/tc-s-23/01-initial-state.png');

    const nonExistentSkill = 'NonExistentSkill-12345';
    await page.evaluate((skillName) => {
      const url = new URL(window.location.href);
      url.searchParams.set('highlight', skillName);
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, nonExistentSkill);

    await page.waitForTimeout(1500);
    await takeScreenshot(page, 'skills-hub/tc-s-23/02-after-navigation.png');

    await expect(page.locator('[data-testid="my-skills-section"]')).toBeVisible();
    await takeScreenshot(page, 'skills-hub/tc-s-23/03-page-functional.png');

    const allCards = page.locator('[data-testid^="my-skill-card-"]');
    const cardCount = await allCards.count();
    await Promise.all(
      Array.from({ length: cardCount }, (_, index) => expect(allCards.nth(index)).not.toHaveClass(/border-primary-5/))
    );

    await expect.poll(() => page.url()).toContain('highlight=');
    await takeScreenshot(page, 'skills-hub/tc-s-23/04-final-state.png');
  });
});
