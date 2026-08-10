/**
 * Extension-Contributed Agents & Assistants -- E2E tests.
 *
 * Covers: extension agent/assistant contribution discovery and the current
 * management-page boundary for extension assistants.
 *
 * Requires: e2e-full-extension loaded (via AIONUI_EXTENSIONS_PATH=examples/).
 */
import { test, expect } from '../fixtures';
import { goToSettings, getExtensionSnapshot, goToAssistantSettings, getVisibleAssistantIds } from '../helpers';

test.describe('Extension-Contributed Agents & Assistants', () => {
  test('extension agents are discoverable and agent settings renders', async ({ page }) => {
    const snapshot = await getExtensionSnapshot(page);
    expect(snapshot.acpAdapters.map((agent) => agent.id)).toEqual(
      expect.arrayContaining(['e2e-cli-agent', 'e2e-http-agent'])
    );

    await goToSettings(page, 'agent');
    await expect(page.locator('[data-testid="agent-management-page"]')).toBeVisible({ timeout: 10_000 });
  });

  test('extension assistants stay discoverable without entering the unified assistant catalog', async ({ page }) => {
    const snapshot = await getExtensionSnapshot(page);
    expect(snapshot.assistants.map((assistant) => assistant.id)).toContain('ext-e2e-test-assistant');

    await goToAssistantSettings(page);
    await expect(page.locator('[data-testid="assistant-home-shell"]')).toBeVisible({ timeout: 10_000 });
    expect(await getVisibleAssistantIds(page)).not.toContain('ext-e2e-test-assistant');
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

  test('extension contribution snapshot contains the owning extension', async ({ page }) => {
    const snapshot = await getExtensionSnapshot(page);
    const extNames = snapshot.loadedExtensions.map((e) => e.name);
    expect(extNames).toContain('e2e-full-extension');
  });
});
