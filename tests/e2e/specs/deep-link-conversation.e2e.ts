import { expect, test } from '../fixtures';
import { goToGuid, invokeBridge } from '../helpers';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const navigationReference = 'nav_e2e_0123456789abcdef';
const conversationId = 'deep-link-e2e-conversation';
const assistantId = 'deep-link-e2e-assistant';
const assistantName = 'Deep Link Fixture Assistant';
const execFileAsync = promisify(execFile);
const fixtureNavigationTest = process.env.E2E_PACKAGED === '1' ? test.skip : test;
const packagedProtocolTest =
  process.platform === 'darwin' && process.env.E2E_PACKAGED === '1' && process.env.E2E_PROTOCOL_SMOKE === '1'
    ? test
    : test.skip;

test.describe('Conversation deep link', () => {
  fixtureNavigationTest(
    'opens one typed Conversation across cold reload and a repeated minimized-window launch',
    async ({ page, electronApp }) => {
      const forbiddenRequests: string[] = [];
      let resolveCount = 0;
      const observeRequest = (request: { method(): string; url(): string }) => {
        const url = new URL(request.url());
        const forbidden =
          request.method() !== 'GET' &&
          (url.pathname === '/api/conversations' ||
            url.pathname.endsWith('/messages') ||
            url.pathname.endsWith('/read') ||
            url.pathname.endsWith('/dismiss') ||
            url.pathname.includes('/interaction-requests/'));
        if (forbidden) forbiddenRequests.push(`${request.method()} ${url.pathname}`);
      };
      page.on('request', observeRequest);

      await page.route('**/api/deep-links/resolve', async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(route.request().postDataJSON()).toEqual({
          navigation_reference: navigationReference,
          schema_version: 1,
        });
        resolveCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              navigation_intent_id: 'intent-e2e',
              schema_version: 1,
              target: {
                type: 'conversation',
                conversation_id: conversationId,
              },
              expires_at: '2099-09-01T12:00:00Z',
              trace_id: 'trace-e2e',
            },
          }),
        });
      });
      await page.route('**/api/deep-links/ack', async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(route.request().postDataJSON()).toEqual({
          navigation_intent_id: 'intent-e2e',
          idempotency_key: expect.stringMatching(/^gea-ui-/),
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: null }),
        });
      });

      await page.route(`**/api/conversations/${conversationId}**`, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.pathname === `/api/conversations/${conversationId}`) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: conversationId,
                created_at: 1,
                modified_at: 1,
                name: 'Deep Link Fixture Conversation',
                type: 'acp',
                extra: { backend: 'codex' },
                assistant: {
                  id: assistantId,
                  source: 'managed',
                  name: assistantName,
                  avatar: '🤖',
                  backend: 'codex',
                },
              },
            }),
          });
          return;
        }
        if (request.method() === 'GET' && url.pathname.endsWith('/messages')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                items: [],
                oldest_cursor: null,
                newest_cursor: null,
                has_more_before: false,
                has_more_after: false,
              },
            }),
          });
          return;
        }
        await route.fallback();
      });

      try {
        const deepLinkUrl = `aionui://open-conversation?ref=${navigationReference}&v=1`;
        if (process.env.E2E_INITIAL_DEEP_LINK === deepLinkUrl) {
          const initialNavigationCompleted = await page
            .waitForURL(new RegExp(`/conversation/${conversationId}$`), { timeout: 1_000 })
            .then(() => true)
            .catch(() => false);
          if (!initialNavigationCompleted) await page.reload();
        } else {
          await goToGuid(page);
          await page.reload();
          await page.waitForLoadState('domcontentloaded');
          await electronApp.evaluate(({ app }, url) => {
            app.emit('open-url', { preventDefault() {} } as never, url);
          }, deepLinkUrl);
        }

        await expect(page).toHaveURL(new RegExp(`/conversation/${conversationId}$`), { timeout: 10_000 });
        await expect(page.getByText(assistantName).first()).toBeVisible({ timeout: 10_000 });
        await expect.poll(() => invokeBridge(page, 'deep-link.claim-pending')).toBeNull();
        const resolveCountAfterColdNavigation = resolveCount;
        expect(resolveCountAfterColdNavigation).toBeGreaterThan(0);

        await goToGuid(page);
        await electronApp.evaluate(({ app, BrowserWindow }, url) => {
          const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
          win?.minimize();
          app.emit('second-instance', {} as never, [], '', { deepLinkUrl: url });
        }, deepLinkUrl);

        await expect(page).toHaveURL(new RegExp(`/conversation/${conversationId}$`), { timeout: 10_000 });
        await expect(page.getByText(assistantName).first()).toBeVisible({ timeout: 10_000 });
        await expect.poll(() => invokeBridge(page, 'deep-link.claim-pending')).toBeNull();
        await expect
          .poll(() =>
            electronApp.evaluate(({ BrowserWindow }) => {
              const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
              return { minimized: win?.isMinimized(), visible: win?.isVisible() };
            })
          )
          .toEqual({ minimized: false, visible: true });
        expect(resolveCount).toBe(resolveCountAfterColdNavigation + 1);
        expect(forbiddenRequests).toEqual([]);
      } finally {
        page.off('request', observeRequest);
        await page.unroute('**/api/deep-links/resolve');
        await page.unroute('**/api/deep-links/ack');
        await page.unroute(`**/api/conversations/${conversationId}**`);
      }
    }
  );

  packagedProtocolTest(
    'installed macOS protocol delivers an opaque pending reference without bypassing login',
    async ({ page, electronApp }) => {
      const deepLinkUrl = `aionui://open-conversation?ref=${navigationReference}&v=1`;
      await expect.poll(() => electronApp.evaluate(({ app }) => app.isDefaultProtocolClient('aionui'))).toBe(true);
      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
        win?.minimize();
      });

      await execFileAsync('open', [deepLinkUrl]);

      await expect
        .poll(() =>
          electronApp.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
            return { minimized: win?.isMinimized(), visible: win?.isVisible() };
          })
        )
        .toEqual({ minimized: false, visible: true });
      await expect
        .poll(() => invokeBridge(page, 'deep-link.claim-pending'))
        .toEqual({ action: 'open-conversation', params: { ref: navigationReference, v: '1' } });
    }
  );
});
