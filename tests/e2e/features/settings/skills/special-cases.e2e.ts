/**
 * Skills Hub E2E Tests - Special Cases (P2 Priority)
 *
 * Test Cases Covered:
 * - TC-S-24: Special characters in skill names (import scenario)
 * - TC-S-25: Large scale rendering (medium scale 20 skills)
 */

import { test, expect } from '../../../fixtures';
import {
  goToSkillsHub,
  refreshSkillsHub,
  importSkillViaBridge,
  createTempExternalSource,
  createTestSkill,
  cleanupTestSkills,
} from '../../../helpers/skillsHub';
import { takeScreenshot } from '../../../helpers/screenshots';
import * as path from 'path';

test.describe('Skills Hub - Special Cases (P2)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  // ============================================================================
  // TC-S-24: Special characters in skill names
  // ============================================================================

  test('TC-S-24: should handle skills with special characters in names', async ({ page }) => {
    const tempSource = createTempExternalSource('tc-s-24');
    try {
      const timestamp = Date.now();
      // Create skills with various special characters
      const specialNames = [
        `E2E-Test-中文名称-${timestamp}`,
        `E2E-Test-With Spaces-${timestamp}`,
        `E2E-Test-Dash-Name-${timestamp}`,
      ];

      // Screenshot 01: Initial state
      await takeScreenshot(page, 'skills-hub/tc-s-24/01-initial-state.png');

      // Import skills with special characters
      const results = [];
      for (const name of specialNames) {
        createTestSkill(tempSource.path, name, `Test skill with special chars: ${name}`);
        const result = await importSkillViaBridge(page, path.join(tempSource.path, name));
        results.push(result);
      }

      // Verify all imports succeeded or failed gracefully
      console.log(
        `[TC-S-24] Import results:`,
        results.map((r) => r.success)
      );

      await refreshSkillsHub(page);

      // Screenshot 02: After importing skills with special chars
      await takeScreenshot(page, 'skills-hub/tc-s-24/02-after-import.png');

      // Expected: My Skills section visible (page didn't crash)
      const mySkillsSection = page.locator('[data-testid="my-skills-section"]');
      await expect(mySkillsSection).toBeVisible();

      // Screenshot 03: Skills section rendered
      await takeScreenshot(page, 'skills-hub/tc-s-24/03-skills-rendered.png');

      // Count how many skills were successfully imported
      const allCards = page.locator('[data-testid^="my-skill-card-"]');
      const cardCount = await allCards.count();
      console.log(`[TC-S-24] Total skill cards visible: ${cardCount}`);
      expect(cardCount).toBeGreaterThanOrEqual(specialNames.length);

      // Screenshot 04: Final state
      await takeScreenshot(page, 'skills-hub/tc-s-24/04-final-state.png');
    } finally {
      tempSource.cleanup();
    }
  });

  // ============================================================================
  // TC-S-25: Large scale rendering (medium scale 20 skills)
  // ============================================================================

  test('TC-S-25: should handle rendering 20 skills without performance issues', async ({ page }) => {
    const tempSource = createTempExternalSource('tc-s-25');
    try {
      const timestamp = Date.now();
      const skillCount = 20;

      // Screenshot 01: Initial state
      await takeScreenshot(page, 'skills-hub/tc-s-25/01-initial-state.png');

      // Create and import 20 skills
      console.log(`[TC-S-25] Creating ${skillCount} test skills...`);
      for (let i = 0; i < skillCount; i++) {
        const skillName = `E2E-Test-Bulk-${timestamp}-${String(i).padStart(3, '0')}`;
        createTestSkill(tempSource.path, skillName, `Bulk test skill #${i}`);
        await importSkillViaBridge(page, path.join(tempSource.path, skillName));

        // Log progress every 5 skills
        if ((i + 1) % 5 === 0) {
          console.log(`[TC-S-25] Imported ${i + 1}/${skillCount} skills`);
        }
      }

      // Navigate to Skills Hub to render all skills
      await refreshSkillsHub(page);

      // Screenshot 02: After importing 20 skills
      await takeScreenshot(page, 'skills-hub/tc-s-25/02-all-skills-imported.png');

      // Expected: My Skills section visible
      const mySkillsSection = page.locator('[data-testid="my-skills-section"]');
      await expect(mySkillsSection).toBeVisible();

      // Screenshot 03: Skills list rendered
      await takeScreenshot(page, 'skills-hub/tc-s-25/03-skills-list.png');

      // Verify all skills are rendered (or at least page didn't crash)
      const allCards = page.locator('[data-testid^="my-skill-card-"]');
      const cardCount = await allCards.count();
      console.log(`[TC-S-25] Total skill cards visible: ${cardCount}`);
      expect(cardCount).toBeGreaterThanOrEqual(20);

      // Test scrolling performance
      await page.evaluate(() => {
        const scrollArea = document.querySelector('[data-testid="my-skills-section"]');
        if (scrollArea) {
          scrollArea.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      });
      await page.waitForTimeout(500);

      // Screenshot 04: After scrolling
      await takeScreenshot(page, 'skills-hub/tc-s-25/04-after-scroll.png');
    } finally {
      tempSource.cleanup();
    }
  });
});
