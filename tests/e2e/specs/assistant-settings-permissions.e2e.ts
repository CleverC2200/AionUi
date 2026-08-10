/**
 * Assistant Settings Permissions — E2E tests.
 *
 * Covers: field-level permissions for builtin and custom assistant types.
 */
import { test, expect } from '../fixtures';
import {
  goToAssistantSettings,
  openAssistantEditor,
  closeAssistantEditor,
  clickCreateAssistant,
  fillAssistantName,
  httpGet,
  saveAssistant,
  waitForAssistantEditorClose,
  BTN_SAVE_ASSISTANT,
  BTN_DELETE_ASSISTANT,
  ASSISTANT_EDITOR_SURFACE,
} from '../helpers';

test.describe('Assistant Settings Permissions', () => {
  test.setTimeout(90_000);

  // Resolve source from the backend so tab visibility cannot affect type detection.
  async function findAssistantByType(
    page: import('@playwright/test').Page,
    type: 'builtin' | 'custom'
  ): Promise<string | null> {
    const assistants = await httpGet<Array<{ id: string; source: string }>>(page, '/api/assistants');
    const source = type === 'builtin' ? 'builtin' : 'user';
    return assistants.find((assistant) => assistant.source === source)?.id ?? null;
  }

  test('builtin — name/desc/avatar read-only', async ({ page }) => {
    await goToAssistantSettings(page);

    const builtinId = await findAssistantByType(page, 'builtin');
    if (!builtinId) {
      test.skip(true, 'No builtin assistant found');
      return;
    }

    await openAssistantEditor(page, builtinId);

    const nameInput = page.locator('[data-testid="input-assistant-name"]');
    const descInput = page.locator('[data-testid="input-assistant-desc"]');

    await expect(nameInput).toBeDisabled();
    await expect(descInput).toBeDisabled();

    await closeAssistantEditor(page);
  });

  test('builtin — Main Agent editable', async ({ page }) => {
    await goToAssistantSettings(page);

    const builtinId = await findAssistantByType(page, 'builtin');
    if (!builtinId) {
      test.skip(true, 'No builtin assistant found');
      return;
    }

    await openAssistantEditor(page, builtinId);

    const editor = page.locator(ASSISTANT_EDITOR_SURFACE);
    const agentSelect = editor.locator('[data-testid="select-assistant-agent"]');
    const isDisabled = await agentSelect.locator('.arco-select-view-disabled').count();
    expect(isDisabled).toBe(0);

    await closeAssistantEditor(page);
  });

  test('builtin — no delete button', async ({ page }) => {
    await goToAssistantSettings(page);

    const builtinId = await findAssistantByType(page, 'builtin');
    if (!builtinId) {
      test.skip(true, 'No builtin assistant found');
      return;
    }

    await openAssistantEditor(page, builtinId);

    const deleteBtn = page.locator(BTN_DELETE_ASSISTANT);
    await expect(deleteBtn).not.toBeVisible();

    await closeAssistantEditor(page);
  });

  test('builtin — save button enabled', async ({ page }) => {
    await goToAssistantSettings(page);

    const builtinId = await findAssistantByType(page, 'builtin');
    if (!builtinId) {
      test.skip(true, 'No builtin assistant found');
      return;
    }

    await openAssistantEditor(page, builtinId);

    const saveBtn = page.locator(BTN_SAVE_ASSISTANT);
    await expect(saveBtn).not.toBeDisabled();

    await closeAssistantEditor(page);
  });

  test('custom — all fields editable', async ({ page }) => {
    await goToAssistantSettings(page);

    let customId = await findAssistantByType(page, 'custom');
    if (!customId) {
      await clickCreateAssistant(page);
      await fillAssistantName(page, `Permissions Custom ${Date.now()}`);
      await saveAssistant(page);
      await waitForAssistantEditorClose(page);
      customId = await findAssistantByType(page, 'custom');
    }
    expect(customId).toBeTruthy();

    await openAssistantEditor(page, customId!);

    const nameInput = page.locator('[data-testid="input-assistant-name"]');
    const descInput = page.locator('[data-testid="input-assistant-desc"]');
    const saveBtn = page.locator(BTN_SAVE_ASSISTANT);
    const deleteBtn = page.locator(BTN_DELETE_ASSISTANT);

    await expect(nameInput).not.toBeDisabled();
    await expect(descInput).not.toBeDisabled();
    await expect(saveBtn).not.toBeDisabled();
    await expect(deleteBtn).toBeVisible();

    await closeAssistantEditor(page);
  });
});
