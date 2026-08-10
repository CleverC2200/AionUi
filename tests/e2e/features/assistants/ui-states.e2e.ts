/**
 * Assistant Settings UI States (P1) — current tabbed home and full-page editor.
 */
import { test, expect } from '../../fixtures';
import {
  clickCreateAssistant,
  closeAssistantEditor,
  duplicateAssistant,
  fillAssistantName,
  goToAssistantSettings,
  saveAssistant,
  takeScreenshot,
  waitForAssistantEditorClose,
} from '../../helpers';

test.describe('Assistant Settings UI States (P1)', () => {
  test.setTimeout(90_000);

  test('P1-1: page exposes Enabled, My Assistants, and Official tabs', async ({ page }) => {
    await goToAssistantSettings(page);

    await expect(page.locator('[data-testid="assistants-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="assistant-home-body"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab-enabled"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab-mine"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab-official"]')).toBeVisible();
    await takeScreenshot(page, 'assistants/p1-1/01-tabbed-home.png');
  });

  test('P1-2: official and user-created assistants appear in their respective tabs', async ({ page }) => {
    await goToAssistantSettings(page);
    await page.locator('[data-testid="settings-tab-official"]').click();
    await expect(page.locator('[data-testid^="official-card-"]').first()).toBeVisible({ timeout: 10_000 });

    const name = `P1 custom ${Date.now()}`;
    await clickCreateAssistant(page);
    await fillAssistantName(page, name);
    await saveAssistant(page);
    await waitForAssistantEditorClose(page);

    await expect(page.locator('[data-testid="settings-tab-mine"]')).toHaveAttribute('aria-selected', 'true');
    const customCard = page.locator('[data-testid^="assistant-card-"]').filter({ hasText: name }).first();
    await expect(customCard).toBeVisible({ timeout: 10_000 });
    await expect(customCard.locator('xpath=ancestor-or-self::*[@data-testid="group-created-section"]')).toBeVisible();
    await takeScreenshot(page, 'assistants/p1-2/01-tab-groups.png');
  });

  test('P1-3: card action menus match assistant ownership', async ({ page }) => {
    await goToAssistantSettings(page);
    await page.locator('[data-testid="settings-tab-official"]').click();
    const officialCard = page.locator('[data-testid^="official-card-"]').first();
    await expect(officialCard).toBeVisible({ timeout: 10_000 });
    const officialId = ((await officialCard.getAttribute('data-testid')) ?? '').replace('official-card-', '');
    await page.locator(`[data-testid="btn-assistant-more-${officialId}"]`).click();
    await expect(page.locator(`[data-testid="menu-settings-${officialId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="menu-duplicate-${officialId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="menu-delete-${officialId}"]`)).toHaveCount(0);
    await page.keyboard.press('Escape');

    const name = `P1 row actions ${Date.now()}`;
    await clickCreateAssistant(page);
    await fillAssistantName(page, name);
    await saveAssistant(page);
    await waitForAssistantEditorClose(page);
    const customCard = page.locator('[data-testid^="assistant-card-"]').filter({ hasText: name }).first();
    await expect(customCard).toBeVisible({ timeout: 10_000 });
    const customId = ((await customCard.getAttribute('data-testid')) ?? '').replace('assistant-card-', '');
    await page.locator(`[data-testid="btn-assistant-more-${customId}"]`).click();
    await expect(page.locator(`[data-testid="menu-edit-${customId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="menu-delete-${customId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="menu-duplicate-${customId}"]`)).toHaveCount(0);
    await takeScreenshot(page, 'assistants/p1-3/01-action-menus.png');
  });

  test('P1-4: extension assistants stay outside the unified assistant catalog', async ({ page }) => {
    await goToAssistantSettings(page);
    await page.locator('[data-testid="settings-tab-mine"]').click();

    await expect(page.locator('[data-testid^="assistant-card-ext-"]')).toHaveCount(0);
    await takeScreenshot(page, 'assistants/p1-4/01-extension-assistant-excluded.png');
  });

  test('P1-5: official card opens the full-page editor and back closes it', async ({ page }) => {
    await goToAssistantSettings(page);
    await page.locator('[data-testid="settings-tab-official"]').click();
    await page.locator('[data-testid^="official-card-"]').first().click();

    const editor = page.locator('[data-testid="assistant-editor-page"]');
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="assistant-editor-bar"]')).toBeVisible();
    await closeAssistantEditor(page);
    await expect(editor).toBeHidden({ timeout: 5_000 });
    await takeScreenshot(page, 'assistants/p1-5/01-editor-roundtrip.png');
  });

  test('P1-6: duplicate from official card opens create-mode editor', async ({ page }) => {
    await goToAssistantSettings(page);
    await page.locator('[data-testid="settings-tab-official"]').click();
    const officialCard = page.locator('[data-testid^="official-card-"]').first();
    await expect(officialCard).toBeVisible({ timeout: 10_000 });
    const officialId = ((await officialCard.getAttribute('data-testid')) ?? '').replace('official-card-', '');

    await duplicateAssistant(page, officialId);
    await expect(page.locator('[data-testid="assistant-editor-page"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="btn-save-assistant"]')).toContainText(/Create|创建/i);
    await takeScreenshot(page, 'assistants/p1-6/01-duplicate-opens-create.png');
  });
});
