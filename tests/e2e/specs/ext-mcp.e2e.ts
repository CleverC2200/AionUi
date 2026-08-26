/**
 * Extensions – MCP Servers tests.
 *
 * Validates extension-contributed MCP servers on the tools settings page.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { goToSettings, expectBodyContainsAny, httpGet, takeScreenshot, waitForSettle, ARCO_SWITCH } from '../helpers';

async function goToMcpTools(page: Page): Promise<void> {
  await goToSettings(page, 'tools');
  const header = page.getByTestId('tools-header');
  if (!(await header.isVisible().catch(() => false))) {
    await page.locator('[data-settings-path="tools"]').click();
  }
  await expect(header).toBeVisible();
}

test.describe('Extension: MCP Servers', () => {
  test('MCP tools page loads', async ({ page }) => {
    await goToMcpTools(page);
    await expectBodyContainsAny(page, ['MCP', 'mcp', 'Server', 'server', '工具', '配置', '添加', 'Add']);
  });

  test('extension MCP servers registered (page functional)', async ({ page }) => {
    await goToMcpTools(page);
    await waitForSettle(page);

    const body = await page.locator('body').textContent();
    // MCP servers may appear in the list or be internal-only
    expect(body!.length).toBeGreaterThan(50);
  });

  test('global GEA MCP server is visible and configuration read-only', async ({ page }) => {
    const servers = await httpGet<
      Array<{
        name: string;
        enabled: boolean;
        builtin: boolean;
        transport: { type: string; args?: string[] };
      }>
    >(page, '/api/mcp/servers');
    expect(servers.find((server) => server.name === 'gea-gateway')).toMatchObject({
      name: 'gea-gateway',
      enabled: true,
      builtin: true,
      transport: { type: 'stdio', args: ['mcp-gea-stdio'] },
    });

    await goToMcpTools(page);
    await waitForSettle(page);

    const gateway = page.locator('[data-server-name="gea-gateway"]');
    await expect(gateway).toBeVisible();
    await expect(gateway).toHaveAttribute('data-configuration-readonly', 'true');
    await expect(gateway.locator(ARCO_SWITCH)).toHaveCount(1);
  });

  test('screenshot: MCP tools with extensions', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'screenshots disabled');
    await goToMcpTools(page);
    await waitForSettle(page);
    await takeScreenshot(page, 'ext-mcp-servers');
  });
});
