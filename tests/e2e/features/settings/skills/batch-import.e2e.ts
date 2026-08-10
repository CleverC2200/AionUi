/**
 * Skills Hub E2E Tests - Batch Import (P1 Priority)
 *
 * Test Cases Covered:
 * - TC-S-11: Import a parent folder containing multiple skills
 */

import { test, expect } from '../../../fixtures';
import {
  goToSkillsHub,
  refreshSkillsHub,
  getMySkills,
  importSkillViaBridge,
  createTempExternalSource,
  createTestSkill,
  cleanupTestSkills,
  normalizeTestId,
} from '../../../helpers/skillsHub';
import { takeScreenshot } from '../../../helpers/screenshots';
import * as path from 'path';

test.describe('Skills Hub - Batch Import (P1)', () => {
  test.beforeEach(async ({ page }) => {
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  // ============================================================================
  // TC-S-11: Import a parent folder and overwrite an existing skill of the same name
  // ============================================================================

  test('TC-S-11: should import every skill from a parent folder', async ({ page }) => {
    // Setup: Create an import folder with 3 skills
    const tempSource = createTempExternalSource('tc-s-11');
    try {
      const timestamp = Date.now();
      const skill1 = `E2E-Test-Batch-1-${timestamp}`;
      const skill2 = `E2E-Test-Batch-2-${timestamp}`;
      const skill3 = `E2E-Test-Batch-3-${timestamp}`;

      createTestSkill(tempSource.path, skill1, 'Valid skill #1');
      createTestSkill(tempSource.path, skill2, 'Already exists in Custom Skills');
      createTestSkill(tempSource.path, skill3, 'Valid skill #3');

      // Pre-import skill2 to cover the current overwrite-on-name-conflict contract.
      const preImport = await importSkillViaBridge(page, path.join(tempSource.path, skill2));
      expect(preImport.success).toBe(true);

      // Verify one skill exists before importing the parent folder.
      let mySkills = await getMySkills(page);
      let testSkills = mySkills.filter((s) => s.name.includes(`-${timestamp}`));
      expect(testSkills.length).toBe(1);
      expect(testSkills[0].name).toBe(skill2);

      const batchImport = await importSkillViaBridge(page, tempSource.path);
      expect(batchImport.success).toBe(true);

      // All three skills now exist; skill2 was overwritten rather than duplicated.
      mySkills = await getMySkills(page);
      testSkills = mySkills.filter((s) => s.name.includes(`-${timestamp}`));
      expect(testSkills.length).toBe(3);

      // Refresh the current Skills page and verify the imported cards.
      await refreshSkillsHub(page);
      const card1 = page.locator(`[data-testid="my-skill-card-${normalizeTestId(skill1)}"]`);
      const card3 = page.locator(`[data-testid="my-skill-card-${normalizeTestId(skill3)}"]`);
      await expect(card1).toBeVisible();
      await expect(card3).toBeVisible();

      await takeScreenshot(page, 'skills-hub/tc-s-11/imported-parent-folder.png');
    } finally {
      tempSource.cleanup();
    }
  });
});
