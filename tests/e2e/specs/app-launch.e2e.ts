/**
 * App Launch – basic smoke tests.
 *
 * Verifies the Electron window opens, the renderer loads, and no
 * critical console errors are thrown on startup.
 */
import { test, expect } from '../fixtures';
import { createErrorCollector, waitForSettle } from '../helpers';

test.describe('App Launch', () => {
  test('window opens with the GEA product identity', async ({ page, electronApp }) => {
    const title = await page.title();
    expect(title).toBe('GEA');
    expect(await electronApp.evaluate(({ app }) => app.getName())).toBe('GEA');
    const profile = await electronApp.evaluate(({ app }) => ({
      data: app.getPath('userData'),
      session: app.getPath('sessionData'),
      sandbox: process.env.AIONUI_E2E_USER_DATA_DIR,
    }));
    expect(profile.data).toBe(profile.sandbox);
    expect(profile.session).toBe(profile.data);
    if (process.platform === 'darwin') {
      const menu = await electronApp.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.items[0];
        return { label: item?.label, children: item?.submenu?.items.map((child) => child.label) };
      });
      expect(menu.label).toBe('GEA');
      expect(menu.children?.join(' ')).not.toContain('GEAUi');
    }
    await page.getByTestId('assistant-surface-switcher').click();
    await page.getByTestId('assistant-surface-option-general').click();
    await expect(page.getByTestId('assistant-surface-switcher')).toHaveText('GEA');
    await expect(page).toHaveURL(/#\/guid$/);
    await page.getByTestId('assistant-surface-switcher').screenshot({ path: 'tests/e2e/results/gea-brand-launch.png' });
  });

  test('renderer loads successfully', async ({ page }) => {
    await page.waitForSelector('body', { state: 'visible' });
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('no uncaught console errors on load', async ({ page }) => {
    const collector = createErrorCollector(page);
    await waitForSettle(page);
    expect(collector.critical()).toHaveLength(0);
  });
});
