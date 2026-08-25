import { expect, test } from '../fixtures';
import { httpDelete, httpGet, selectAssistantForBackend, waitForAiReply } from '../helpers';
import { goToGuid } from '../helpers/navigation';
import { GUID_INPUT } from '../helpers/selectors';

type Provider = {
  id: string;
  name: string;
  models?: string[];
  model?: string[];
  enabled?: boolean;
};

const providerId = process.env.AIONUI_E2E_LIVE_PROVIDER_ID?.trim();
const modelName = process.env.AIONUI_E2E_LIVE_MODEL?.trim();
const verifyHeartbeat = process.env.AIONUI_E2E_VERIFY_HEARTBEAT === '1';

async function waitForDesktopHeartbeat(page: import('@playwright/test').Page) {
  // AionCore checks every 30 seconds and closes connections whose last pong is
  // older than 60 seconds. Waiting through the next check reproduces the real
  // idle-desktop failure without relying on Playwright exposing Electron's
  // renderer WebSocket frames.
  await page.waitForTimeout(95_000);
}

async function selectProviderModel(page: import('@playwright/test').Page, provider: Provider, model: string) {
  const button = page.getByTestId('guid-model-selector');
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();

  const popup = page.locator('.arco-dropdown-menu:visible').last();
  await popup.waitFor({ state: 'visible', timeout: 5_000 });
  await expect(popup).toContainText(provider.name);
  const option = popup.getByText(model, { exact: true }).last();
  await option.click();
  await expect(button).toContainText(model);
}

async function expectImmediateFeedback(page: import('@playwright/test').Page, startedAt: number) {
  await expect(page.getByTestId('conversation-processing-feedback')).toBeVisible({ timeout: 1_000 });
  return Date.now() - startedAt;
}

test.describe('Aionrs live personal provider feedback', () => {
  test.skip(
    !providerId || !modelName,
    'Set AIONUI_E2E_LIVE_PROVIDER_ID and AIONUI_E2E_LIVE_MODEL to run this live smoke.'
  );
  test.setTimeout(300_000);

  test('uses the selected personal provider on the first turn and shows immediate feedback on later sends', async ({
    page,
  }, testInfo) => {
    const providers = await httpGet<Provider[]>(page, '/api/providers');
    const provider = providers.find((item) => item.id === providerId);
    expect(provider, `Live provider ${providerId} must exist`).toBeTruthy();
    if (!provider || !providerId || !modelName) return;

    const models = provider.models ?? provider.model ?? [];
    expect(provider.enabled).not.toBe(false);
    expect(models).toContain(modelName);

    if (verifyHeartbeat) {
      await waitForDesktopHeartbeat(page);
      console.log('[E2E] Heartbeat idle window completed');
    }
    await goToGuid(page);
    console.log('[E2E] Guide page ready after idle window');
    const assistantId = await selectAssistantForBackend(page, 'aionrs');
    expect(assistantId).toBeTruthy();
    await selectProviderModel(page, provider, modelName);
    console.log('[E2E] Personal provider selected after idle window');

    let conversationId: string | null = null;
    try {
      const createRequest = page.waitForRequest(
        (request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api/conversations')
      );
      const input = page.locator(GUID_INPUT);
      await input.fill('只回复：AIONUI_E2E_OK');
      const firstStartedAt = Date.now();
      await input.press('Enter');

      const request = await createRequest;
      console.log('[E2E] First conversation request accepted');
      const payload = request.postDataJSON() as {
        model?: { id?: string; provider_id?: string; use_model?: string; model?: string };
        assistant?: { conversation_overrides?: { model?: string } };
      };
      expect(payload.model?.id ?? payload.model?.provider_id).toBe(providerId);
      expect(payload.model?.use_model ?? payload.model?.model).toBe(modelName);
      expect(payload.assistant?.conversation_overrides?.model).toBe(modelName);

      await page.waitForFunction(() => window.location.hash.includes('/conversation/'), undefined, { timeout: 15_000 });
      conversationId = (await page.evaluate(() => window.location.hash)).split('/conversation/')[1] ?? null;
      expect(conversationId).toBeTruthy();
      const firstFeedbackMs = await expectImmediateFeedback(page, firstStartedAt);
      const firstReply = await waitForAiReply(page, 120_000);
      expect(firstReply).toContain('AIONUI_E2E_OK');
      console.log('[E2E] First personal provider reply rendered');

      const existingReplies = await page.locator('[data-testid="message-text-left"]').count();
      const chatInput = page.locator('textarea:visible').first();
      await chatInput.fill('只回复：AIONUI');
      const secondStartedAt = Date.now();
      await chatInput.press('Enter');
      const secondFeedbackMs = await expectImmediateFeedback(page, secondStartedAt);

      await expect
        .poll(() => page.locator('[data-testid="message-text-left"]').count(), { timeout: 120_000 })
        .toBeGreaterThan(existingReplies);
      const secondReply = await waitForAiReply(page, 120_000);
      expect(secondReply).toContain('AIONUI');
      console.log('[E2E] Second personal provider reply rendered');

      console.log(`[E2E] Personal provider feedback: first=${firstFeedbackMs}ms second=${secondFeedbackMs}ms`);
      await testInfo.attach('live-provider-feedback-timing.json', {
        body: Buffer.from(JSON.stringify({ firstFeedbackMs, secondFeedbackMs }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      if (conversationId) {
        await httpDelete(page, `/api/conversations/${conversationId}`).catch(() => {});
      }
    }
  });
});
