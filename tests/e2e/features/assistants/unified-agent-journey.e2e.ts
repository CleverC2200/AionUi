import type { ElectronApplication, Page, Route } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { closeAssistantEditor, goToAssistantSettings, takeScreenshot } from '../../helpers';

const MANAGED_ASSISTANT_ID = 'enterprise-finance';

const managedMetadata = {
  assignment_id: 'assignment-finance',
  template_id: 'finance-close',
  template_version: '1.0.0',
  catalog_revision: 'catalog-e2e-r1',
  activation: 'required' as const,
  state: 'active' as const,
  minimum_client_version: '0.0.1',
  sync_status: 'fresh' as const,
  required_skill_ids: ['finance-close'],
  required_mcp_ids: ['finance-production'],
  user_extensions: { mode: 'additive' as const, allow_skills: true, allow_mcps: true },
  extensions: {
    revision: 'extensions-e2e-r1',
    skill_ids: [],
    mcp_ids: [],
    status: 'active' as const,
    violations: [],
  },
};

const managedAssistant = {
  id: MANAGED_ASSISTANT_ID,
  source: 'managed' as const,
  name: 'Finance Close',
  name_i18n: { 'zh-CN': '财务关账助手' },
  description: 'Governed finance close with protected production capabilities',
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  agent_id: 'finance-agent',
  agent: { type: 'acp', source: 'internal' as const, acp_backend: 'codex' },
  enabled_skills: ['finance-close'],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context: 'Protected enterprise instructions',
  context_i18n: {},
  prompts: ['Prepare the monthly close'],
  prompts_i18n: {},
  models: [],
  agent_status: 'unchecked' as const,
  team_selectable: true,
  deletable: false,
  managed: managedMetadata,
};

const managedDetail = {
  id: MANAGED_ASSISTANT_ID,
  source: 'managed' as const,
  agent_status: 'unchecked' as const,
  team_selectable: true,
  deletable: false,
  profile: {
    name: managedAssistant.name,
    name_i18n: managedAssistant.name_i18n,
    description: managedAssistant.description,
    description_i18n: {},
  },
  state: { enabled: true, sort_order: 0 },
  engine: { agent_id: 'finance-agent', agent: managedAssistant.agent },
  rules: { content: managedAssistant.context, storage_mode: 'managed' },
  prompts: { recommended: managedAssistant.prompts, recommended_i18n: {} },
  defaults: {
    model: { mode: 'auto' },
    permission: { mode: 'fixed', value: 'acceptEdits' },
    thought_level: { mode: 'auto' },
    skills: { mode: 'fixed', value: ['finance-close'] },
    mcps: { mode: 'fixed', value: ['finance-production'] },
  },
  capabilities: {
    default_skill_ids: ['finance-close'],
    custom_skill_names: [],
    default_disabled_builtin_skill_ids: [],
  },
  preferences: {
    last_skill_ids: [],
    last_disabled_builtin_skill_ids: [],
    last_mcp_ids: [],
  },
  managed: managedMetadata,
};

const managedCatalogRoute = async (route: Route): Promise<void> => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (request.method() !== 'GET') {
    await route.continue();
    return;
  }
  if (pathname.endsWith(`/api/assistants/${MANAGED_ASSISTANT_ID}`)) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managedDetail) });
    return;
  }
  if (pathname.endsWith('/api/assistants')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        assistants: [managedAssistant],
        mode: 'managed',
        sync_status: 'fresh',
        revision: 'catalog-e2e-r1',
      }),
    });
    return;
  }
  await route.continue();
};

const setZoomFactor = async (electronApp: ElectronApplication, factor: number): Promise<void> => {
  await electronApp.evaluate(({ BrowserWindow }, nextFactor) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.isDevToolsOpened());
    window?.webContents.setZoomFactor(nextFactor);
  }, factor);
};

const expectNoPageOverflow = async (page: Page): Promise<void> => {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBe(true);
};

test.describe('Unified assistant journey — standard and managed catalogs', () => {
  test.setTimeout(120_000);

  test('standard AionUi keeps the official catalog-to-detail journey', async ({ page, electronApp }) => {
    await setZoomFactor(electronApp, 1);
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToAssistantSettings(page);
    await page.locator('[data-testid="settings-tab-official"]').click();

    const card = page.locator('[data-testid^="official-card-"]').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expectNoPageOverflow(page);
    await takeScreenshot(page, 'unified-agent-journey/standard-catalog-1440x900.png');

    await card.focus();
    await card.press('Enter');
    await expect(page.locator('[data-testid="assistant-editor-page"]')).toBeVisible();
    await takeScreenshot(page, 'unified-agent-journey/standard-detail-1440x900.png');
    await closeAssistantEditor(page);
  });

  test('GEA managed catalog protects core capabilities across the viewport matrix', async ({ page, electronApp }) => {
    await page.route('**/api/assistants*', managedCatalogRoute);
    try {
      await page.reload();
      await goToAssistantSettings(page);
      await page.locator('[data-testid="settings-tab-official"]').click();

      const card = page.getByTestId(`official-card-${MANAGED_ASSISTANT_ID}`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText(/Finance Close|财务关账助手/);
      await expect(card).toContainText(/Enterprise managed|企业管理/);
      await expect(page.getByTestId(`switch-enabled-${MANAGED_ASSISTANT_ID}`)).toBeDisabled();
      await expect(page.getByTestId(`menu-duplicate-${MANAGED_ASSISTANT_ID}`)).toHaveCount(0);

      const viewports = [
        { width: 1440, height: 900, zoom: 1, name: 'wide-100' },
        { width: 1440, height: 900, zoom: 1.25, name: 'wide-125' },
        { width: 1024, height: 768, zoom: 1.5, name: 'narrow-150' },
        { width: 720, height: 900, zoom: 2, name: 'high-zoom-200' },
        { width: 390, height: 844, zoom: 1, name: 'mobile-390' },
      ];
      /* eslint-disable no-await-in-loop -- one Electron page must settle each viewport before the next mutation */
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setZoomFactor(electronApp, viewport.zoom);
        await expect(card).toBeVisible();
        await expectNoPageOverflow(page);
        await takeScreenshot(page, `unified-agent-journey/managed-${viewport.name}.png`);
      }
      /* eslint-enable no-await-in-loop */

      await setZoomFactor(electronApp, 1);
      await page.setViewportSize({ width: 1440, height: 900 });
      await card.focus();
      await card.press('Enter');
      await expect(page.getByTestId('assistant-managed-governance-banner')).toBeVisible();
      await expect(page.getByTestId('input-assistant-name')).toBeDisabled();
      await expect(page.getByTestId('btn-save-assistant')).toBeEnabled();
      await takeScreenshot(page, 'unified-agent-journey/managed-detail-1440x900.png');
      await closeAssistantEditor(page);
    } finally {
      await setZoomFactor(electronApp, 1);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.unroute('**/api/assistants*', managedCatalogRoute);
    }
  });
});
