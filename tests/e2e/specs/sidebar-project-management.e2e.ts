/**
 * Sidebar project management — add projects from both entry points and remove them again.
 */
import type { Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect } from '../fixtures';
import { goToGuid } from '../helpers';

const RECENT_WORKSPACES_KEY = 'aionui:recent-workspaces';
const SIDEBAR_PROJECTS_KEY = 'aionui:sidebar-projects';

async function removeProjectFromSidebar(page: Page, projectName: string): Promise<void> {
  const project = page.locator('.workspace-collapse').filter({ hasText: projectName }).first();
  await project.hover();

  await project
    .getByRole('button', {
      name: new RegExp(`Project actions for ${projectName}|${projectName} 的项目操作`),
    })
    .click();
  await page
    .locator('.arco-dropdown-menu-item, [role="menuitem"]')
    .filter({ hasText: /Remove project|移除项目/ })
    .last()
    .click();

  const modal = page.locator('.arco-modal').filter({ hasText: projectName }).last();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: /Delete|删除/ }).click();

  await expect(page.locator('.workspace-collapse').filter({ hasText: projectName })).toHaveCount(0);
}

test.describe('Sidebar Project Management', () => {
  test('syncs projects from the composer, adds another project, and removes both', async ({ electronApp, page }) => {
    await goToGuid(page);

    await page.evaluate(
      ({ recentKey, sidebarKey }) => {
        localStorage.setItem(recentKey, '[]');
        localStorage.setItem(sidebarKey, '[]');
      },
      { recentKey: RECENT_WORKSPACES_KEY, sidebarKey: SIDEBAR_PROJECTS_KEY }
    );
    await page.reload();
    await page.waitForSelector('#root > *', { state: 'visible', timeout: 30_000 });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-sidebar-projects-e2e-'));
    const projectPaths = [path.join(root, 'composer-project'), path.join(root, 'sidebar-project')];
    projectPaths.forEach((projectPath) => fs.mkdirSync(projectPath));
    await electronApp.evaluate(async ({ dialog }, paths) => {
      Reflect.set(globalThis, '__aionuiOriginalShowOpenDialog', dialog.showOpenDialog);
      let nextProject = 0;
      dialog.showOpenDialog = () =>
        Promise.resolve({
          canceled: false,
          filePaths: [paths[Math.min(nextProject++, paths.length - 1)]],
        });
    }, projectPaths);

    const [composerProjectPath, sidebarProjectPath] = projectPaths;
    const composerProjectName = composerProjectPath.split(/[\\/]/).pop()!;
    const sidebarProjectName = sidebarProjectPath.split(/[\\/]/).pop()!;

    try {
      await page.locator('[data-testid="workspace-selector-btn"]').click();

      const composerProject = page.locator('.workspace-collapse').filter({ hasText: composerProjectName });
      await expect(composerProject).toBeVisible();
      await expect(composerProject.locator('..')).toContainText(/No chats|没有聊天/);

      await page.getByRole('button', { name: /Add project|添加项目/ }).click();

      const sidebarProject = page.locator('.workspace-collapse').filter({ hasText: sidebarProjectName });
      await expect(sidebarProject).toBeVisible();
      await expect(sidebarProject.locator('..')).toContainText(/No chats|没有聊天/);

      await page.getByRole('button', { name: /Project management|项目管理/ }).click();
      await expect(page.getByText(/By project|按项目/).last()).toBeVisible();
      await expect(page.getByText(/In one list|在一个列表中/).last()).toBeVisible();
      await page.keyboard.press('Escape');

      await removeProjectFromSidebar(page, sidebarProjectName);
      await removeProjectFromSidebar(page, composerProjectName);

      await page.getByRole('button', { name: /Clear|清除/ }).click();
      await expect(page.locator('[data-testid="workspace-selector-btn"]')).toBeVisible();
    } finally {
      await page.evaluate(
        ({ recentKey, sidebarKey }) => {
          localStorage.setItem(recentKey, '[]');
          localStorage.setItem(sidebarKey, '[]');
          window.dispatchEvent(new Event('aionui:sidebar-projects-changed'));
        },
        { recentKey: RECENT_WORKSPACES_KEY, sidebarKey: SIDEBAR_PROJECTS_KEY }
      );
      await electronApp.evaluate(async ({ dialog }) => {
        const original = Reflect.get(globalThis, '__aionuiOriginalShowOpenDialog');
        if (typeof original === 'function') {
          dialog.showOpenDialog = original as typeof dialog.showOpenDialog;
        }
        Reflect.deleteProperty(globalThis, '__aionuiOriginalShowOpenDialog');
      });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
