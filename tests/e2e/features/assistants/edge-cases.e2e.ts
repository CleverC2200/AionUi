/**
 * Assistant Settings Edge Cases (P2) — E2E tests for the current tabbed home
 * and full-page editor design.
 */
import { test, expect } from '../../fixtures';
import { closeAssistantEditor, goToAssistantSettings, takeScreenshot } from '../../helpers';

test.describe('Assistant Settings Edge Cases (P2)', () => {
  test.setTimeout(90_000);

  test('P2-1: navigation intent cleanup remains safe after leaving the editor', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
    });

    await goToAssistantSettings(page);
    await closeAssistantEditor(page);
    await page.locator('[data-testid="settings-tab-official"]').click();
    const card = page.locator('[data-testid^="official-card-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    const assistantId = ((await card.getAttribute('data-testid')) ?? '').replace('official-card-', '');

    await page.evaluate((id) => {
      sessionStorage.setItem(
        'guid.openAssistantEditorIntent',
        JSON.stringify({ assistantId: id, openAssistantEditor: true })
      );
      window.location.hash = '/guid';
    }, assistantId);
    await page.waitForURL(/#\/guid/, { timeout: 5_000 });
    await page.evaluate(() => {
      window.location.hash = '/assistants';
    });
    await expect(page.locator('[data-testid="assistant-editor-page"]')).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => {
      window.location.hash = '/settings/appearance';
    });
    await page.waitForURL(/#\/settings\/appearance/, { timeout: 5_000 });
    await takeScreenshot(page, 'assistants/p2-1/01-editor-unmounted.png');

    const hasCleanupWarning = errors.some((error) => /memory|timer|cleanup/i.test(error));
    expect(hasCleanupWarning).toBe(false);
  });

  test('P2-2: search applies an empty state within the active tab and clears cleanly', async ({ page }) => {
    await goToAssistantSettings(page);
    await page.locator('[data-testid="settings-tab-official"]').click();

    const searchInput = page.locator('[data-testid="input-search-assistants"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('zzz_nonexistent_query_12345');

    const emptyMessage = page.getByText(/No assistants match|没有匹配/i).first();
    await expect(emptyMessage).toBeVisible({ timeout: 5_000 });
    await takeScreenshot(page, 'assistants/p2-2/01-search-empty.png');

    await searchInput.clear();
    await expect(page.locator('[data-testid^="official-card-"]').first()).toBeVisible({ timeout: 5_000 });
    await takeScreenshot(page, 'assistants/p2-2/02-search-cleared.png');
  });
});
