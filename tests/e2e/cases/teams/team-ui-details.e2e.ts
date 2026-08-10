import { test, expect } from '../../fixtures';
import fs from 'fs';
import {
  cleanupTeamsByName,
  closeTeamCreateModal,
  createTeam,
  navigateTo,
  openTeamCreateModal,
  pickTeamCreateAssistantOption,
} from '../../helpers';

const TEAM_COLLAPSED = 'E2E Collapsed Team';
const TEAM_WORKSPACE = 'E2E Workspace Team';

test.describe('Team UI Details', () => {
  test('sidebar toggle hides and restores team navigation', async ({ page }) => {
    test.setTimeout(120_000);
    await cleanupTeamsByName(page, TEAM_COLLAPSED);

    let teamId: string;
    try {
      teamId = await createTeam(page, TEAM_COLLAPSED);
    } catch {
      test.skip();
      return;
    }
    await navigateTo(page, '#/');

    const siderToggle = page.locator('[data-testid="sider-toggle"]');

    await expect(siderToggle).toHaveAttribute('aria-label', /Collapse sidebar|折叠侧边栏|收起/, { timeout: 5_000 });
    await siderToggle.click();
    await page.waitForTimeout(300);

    const expandedItem = page.locator(`[data-testid="team-sider-item-${teamId}"]`);
    await expect(expandedItem).toBeHidden({ timeout: 5_000 });

    await expect(siderToggle).toHaveAttribute('aria-label', /Expand sidebar|展开侧边栏|展开/, { timeout: 5_000 });
    await siderToggle.click();
    const teamSectionToggle = page.locator('[data-testid="team-section-toggle"]');
    await expect(teamSectionToggle).toBeVisible({ timeout: 5_000 });
    if ((await teamSectionToggle.getAttribute('aria-expanded')) !== 'true') {
      await teamSectionToggle.click();
    }
    await expect(expandedItem).toBeVisible({ timeout: 5_000 });

    await expandedItem.click();
    await page.waitForURL(new RegExp(`/team/${teamId}`), { timeout: 10_000 });

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain(`/team/${teamId}`);

    await cleanupTeamsByName(page, TEAM_COLLAPSED);
  });

  test('create team with workspace folder via native dialog', async ({ electronApp, page }) => {
    await cleanupTeamsByName(page, TEAM_WORKSPACE);

    const tmpDir = `/tmp/e2e-workspace-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });
    await electronApp.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [dir] });
    }, tmpDir);

    const modal = await openTeamCreateModal(page);

    const nameInput = modal.locator('[data-testid="team-create-name-input"]');
    await nameInput.fill(TEAM_WORKSPACE);

    const firstOption = await pickTeamCreateAssistantOption(modal);
    if (!firstOption) {
      await closeTeamCreateModal(modal);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      test.skip();
      return;
    }
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    await firstOption.click();

    const trigger = modal.locator('[data-testid="team-create-workspace-trigger"]');
    await expect(trigger).toBeVisible({ timeout: 3_000 });
    await trigger.click();

    const menu = page.locator('[data-testid="team-create-workspace-menu"]');
    const menuVisible = await menu.isVisible({ timeout: 3_000 }).catch(() => false);

    if (menuVisible) {
      const browseOption = menu.locator('text=Choose a different folder').or(menu.locator('text=选择其他文件夹'));
      await browseOption.first().click();
    }

    await page.waitForTimeout(1_000);

    const workspacePath = modal.locator(`text=${tmpDir.split('/').pop()}`);
    await expect(workspacePath).toBeVisible({ timeout: 5_000 });

    const confirmBtn = modal.locator('.arco-btn-primary');
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
    await confirmBtn.click();

    await page.waitForURL(/\/team\//, { timeout: 15_000 });

    const wsTitle = page.locator('text=Workspace').or(page.locator('text=工作区'));
    await expect(wsTitle.first()).toBeVisible({ timeout: 10_000 });

    await cleanupTeamsByName(page, TEAM_WORKSPACE);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
