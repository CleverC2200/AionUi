/**
 * E2E: Create Team modal — narrow-screen (mobile) interaction.
 *
 * At <768px (layout.isMobile) the modal switches from the desktop two-column
 * layout to a single column: only the "Selected members" list + team fields are
 * shown inline, and the assistant picker is moved into a bottom sheet opened via
 * the "Add member" button.
 *
 * The modal is opened at the normal (desktop) width first — the mobile sidebar is
 * collapsed behind a toggle, so opening from a wide window keeps the entry point
 * stable — then the shared Electron window is shrunk below the breakpoint so the
 * already-open modal re-renders into its mobile layout. The size is restored
 * afterwards because the Electron window is shared across specs.
 */
import { test, expect } from '../../fixtures';
import { TEAM_SUPPORTED_BACKENDS, cleanupTeamsByName } from '../../helpers';

const MOBILE_WIDTH = 430;
const MOBILE_HEIGHT = 900;
// Comfortably above the 768px mobile breakpoint so the sidebar entry point and
// the desktop two-column layout are present when we open the modal.
const DESKTOP_WIDTH = 1200;
const DESKTOP_HEIGHT = 900;

async function setWindowContentSize(
  electronApp: import('@playwright/test').ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await electronApp.evaluate(
    async ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('devtools://'));
      win?.setContentSize(size.width, size.height);
    },
    { width, height }
  );
}

test.describe('Team Create - mobile (narrow screen)', () => {
  test.beforeEach(async ({ electronApp }) => {
    // Force a known desktop width regardless of prior state (the window is shared
    // across specs; a previous run may have left it narrow).
    await setWindowContentSize(electronApp, DESKTOP_WIDTH, DESKTOP_HEIGHT);
  });

  test.afterEach(async ({ electronApp, page }) => {
    const modal = page.locator('.team-create-modal');
    if (await modal.isVisible().catch(() => false)) {
      await modal
        .locator('button[aria-label="Close"]')
        .first()
        .click({ force: true })
        .catch(() => {});
      await expect(modal).toBeHidden({ timeout: 5_000 });
    }
    // Restore a known desktop size. The launch size may itself be narrow when
    // Electron restores window state, and that must not leak into later specs.
    await setWindowContentSize(electronApp, DESKTOP_WIDTH, DESKTOP_HEIGHT);
    const createButton = page.locator('[data-testid="team-create-btn"]').first();
    if (!(await createButton.isVisible().catch(() => false))) {
      const expandSider = page.getByRole('button', { name: /Expand sidebar|展开侧边栏|展开/i }).first();
      if (await expandSider.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expandSider.click();
        await expect(createButton).toBeVisible({ timeout: 5_000 });
      }
    }
  });

  test('shows single-column layout and adds a member via the bottom sheet', async ({ electronApp, page }) => {
    // Open the modal at desktop width via the sidebar create button (stable testid).
    const createBtn = page.locator('[data-testid="team-create-btn"]').first();
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();

    const modal = page.locator('.team-create-modal');
    await expect(modal.getByRole('heading', { name: /Create Team|创建团队|New Team|新建团队/i })).toBeVisible({
      timeout: 5_000,
    });

    // Shrink below the breakpoint — the open modal re-renders into its mobile layout.
    await setWindowContentSize(electronApp, MOBILE_WIDTH, MOBILE_HEIGHT);

    // Mobile layout root is present; the desktop two-column root is not.
    const mobileLayout = page.locator('[data-testid="team-create-layout-mobile"]');
    await expect(mobileLayout).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="team-create-layout"]')).toHaveCount(0);

    // Assistant picker is hidden until the sheet is opened.
    await expect(page.locator('[data-testid="team-create-agent-search"]')).toHaveCount(0);

    await page.screenshot({ path: 'tests/e2e/results/team-mobile-01-layout.png' });

    // Open the assistant dropdown from the "Add member" button.
    const addMemberBtn = page.locator('[data-testid="team-create-add-member-btn"]');
    await expect(addMemberBtn).toBeVisible();
    await addMemberBtn.click();

    // The dropdown reveals the reused picker (search + options).
    await expect(page.locator('[data-testid="team-create-agent-search"]')).toBeVisible({ timeout: 5_000 });

    const firstOption = page.locator('[data-testid^="team-create-agent-option-"]').first();
    const hasOption = await firstOption.isVisible({ timeout: 3_000 }).catch(() => false);

    await page.screenshot({ path: 'tests/e2e/results/team-mobile-02-dropdown.png' });

    if (!hasOption || TEAM_SUPPORTED_BACKENDS.size === 0) {
      await modal.locator('button[aria-label="Close"]').first().click({ force: true });
      await expect(modal).toBeHidden({ timeout: 5_000 });
      console.log('[E2E] No supported assistant available — skipping mobile create flow');
      test.skip();
      return;
    }

    // Select an assistant — select-and-close: the dropdown collapses and the
    // member appears in the list below (the "added successfully" feedback).
    await firstOption.click();
    await expect(page.locator('[data-testid="team-create-agent-search"]')).toBeHidden({ timeout: 5_000 });

    const memberRow = page.locator('[data-testid^="team-create-member-draft-"]').first();
    await expect(memberRow).toBeVisible({ timeout: 5_000 });

    const nameInput = page.locator('[data-testid="team-create-name-input"]');
    await nameInput.fill('E2E Mobile Team');

    const confirmBtn = modal.locator('.arco-btn-primary');
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });

    await page.screenshot({ path: 'tests/e2e/results/team-mobile-03-filled.png' });

    await confirmBtn.click();
    await page.waitForURL(/\/team\//, { timeout: 15_000 });

    // Cleanup the created team.
    await cleanupTeamsByName(page, 'E2E Mobile Team');
  });
});
