/**
 * Extension-Contributed Agents & Assistants -- E2E tests.
 *
 * Covers: extension agent/assistant contribution discovery, management-page
 * stability while extensions are loaded, and bridge data correctness.
 *
 * Requires: e2e-full-extension loaded (via AIONUI_EXTENSIONS_PATH=examples/).
 */
import { test, expect } from '../fixtures';
import {
  goToSettings,
  goToGuid,
  waitForSettle,
  getExtensionSnapshot,
  goToAssistantSettings,
  getVisibleAssistantIds,
} from '../helpers';

test.describe('Extension-Contributed Agents & Assistants', () => {
  test('extension agents are discoverable while agent settings remains usable', async ({ page }) => {
    const snapshot = await getExtensionSnapshot(page);
    expect(snapshot.acpAdapters.map((agent) => agent.id)).toEqual(
      expect.arrayContaining(['e2e-cli-agent', 'e2e-http-agent'])
    );

    await goToSettings(page, 'agent');
    await waitForSettle(page, 5_000);
    expect((await page.locator('body').textContent())?.length).toBeGreaterThan(50);
  });

  test('extension assistants are discoverable while assistant settings remains usable', async ({ page }) => {
    const snapshot = await getExtensionSnapshot(page);
    expect(snapshot.assistants.map((assistant) => assistant.id)).toContain('ext-e2e-test-assistant');

    await goToAssistantSettings(page);
    await expect.poll(async () => (await getVisibleAssistantIds(page)).length, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('guid page remains usable with extension contributions loaded', async ({ page }) => {
    await goToGuid(page);
    await waitForSettle(page, 5_000);
    expect((await page.locator('body').textContent())?.length).toBeGreaterThan(50);
  });

  test('extension assistant metadata is complete', async ({ page }) => {
    const snapshot = await getExtensionSnapshot(page);
    const assistant = snapshot.assistants.find((item) => item.id === 'ext-e2e-test-assistant');
    expect(assistant).toMatchObject({
      id: 'ext-e2e-test-assistant',
      name: 'E2E Test Assistant',
    });
  });

  test('extension agent metadata is complete', async ({ page }) => {
    const snapshot = await getExtensionSnapshot(page);
    expect(snapshot.acpAdapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'e2e-cli-agent', name: 'E2E CLI Agent' }),
        expect.objectContaining({ id: 'e2e-http-agent', name: 'E2E HTTP Agent' }),
      ])
    );
  });

  test('extension data correct via IPC bridge', async ({ page }) => {
    const snapshot = await getExtensionSnapshot(page);
    // Verify e2e-full-extension loaded
    const extNames = snapshot.loadedExtensions.map((e) => e.name);
    expect(extNames).toContain('e2e-full-extension');

    // Verify assistant contributed
    const assistantIds = snapshot.assistants.map((a) => a.id);
    expect(assistantIds).toEqual(expect.arrayContaining(['ext-e2e-test-assistant']));

    // Verify ACP adapters contributed
    const adapterIds = snapshot.acpAdapters.map((a) => a.id);
    expect(adapterIds).toEqual(expect.arrayContaining(['e2e-cli-agent', 'e2e-http-agent']));
  });
});
