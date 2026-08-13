/**
 * Sidebar projects come from persisted conversation workspace metadata. The
 * project removal target must also include pinned conversations, even though
 * those conversations render in the separate Pinned section.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect } from '../fixtures';
import { goToGuid } from '../helpers';
import { httpDelete, httpPost } from '../helpers/httpBridge';

const LEGACY_SIDEBAR_PROJECTS_KEY = 'aionui:sidebar-projects';
const LEGACY_PROJECT_NAME = 'legacy-empty-project-that-must-not-render';

type CreatedConversation = { id: string };

test.describe('Sidebar Project Management', () => {
  test('renders conversation-derived projects and counts pinned chats when removing a project', async ({ page }) => {
    await goToGuid(page);

    const suffix = Date.now().toString();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `sidebar-project-${suffix}-`));
    const projectName = path.basename(workspace);
    const regularName = `regular-${suffix}`;
    const pinnedName = `pinned-${suffix}`;
    const createdIds: string[] = [];

    try {
      const regular = await httpPost<CreatedConversation>(page, '/api/conversations', {
        type: 'acp',
        name: regularName,
        extra: { workspace, custom_workspace: true },
      });
      createdIds.push(regular.id);

      const pinned = await httpPost<CreatedConversation>(page, '/api/conversations', {
        type: 'acp',
        name: pinnedName,
        extra: { workspace, custom_workspace: true, pinned: true, pinned_at: Date.now() },
      });
      createdIds.push(pinned.id);

      await page.evaluate(
        ({ storageKey, legacyProject }) => {
          localStorage.setItem(storageKey, JSON.stringify([`/projects/${legacyProject}`]));
        },
        { storageKey: LEGACY_SIDEBAR_PROJECTS_KEY, legacyProject: LEGACY_PROJECT_NAME }
      );
      await page.reload();
      await page.waitForSelector('#root > *', { state: 'visible', timeout: 30_000 });

      const projectLabel = page.getByText(projectName, { exact: true });
      await expect(projectLabel).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(pinnedName, { exact: true })).toBeVisible();
      await expect(page.getByText(LEGACY_PROJECT_NAME, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Sort chats by|聊天排序方式/ })).toHaveCount(0);

      const regularConversation = page.getByText(regularName, { exact: true });
      if (!(await regularConversation.isVisible())) {
        await projectLabel.click();
      }
      await expect(regularConversation).toBeVisible();

      await projectLabel.hover();
      await page.getByRole('button', { name: new RegExp(projectName) }).click();
      await page
        .getByText(/Remove project|移除项目/, { exact: true })
        .last()
        .click();

      const modalBody = page.getByRole('dialog').filter({ hasText: projectName });
      await expect(modalBody).toBeVisible();
      await expect(modalBody).toContainText('2');
      await page.screenshot({ path: 'tests/e2e/results/sidebar-projects-conversation-derived.png' });

      await page
        .getByRole('button', { name: /Cancel|取消/ })
        .last()
        .click();
    } finally {
      await Promise.all(
        createdIds.map((conversationId) =>
          httpDelete(page, `/api/conversations/${encodeURIComponent(conversationId)}`).catch(() => {})
        )
      );
      await page.evaluate((storageKey) => localStorage.removeItem(storageKey), LEGACY_SIDEBAR_PROJECTS_KEY);
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
