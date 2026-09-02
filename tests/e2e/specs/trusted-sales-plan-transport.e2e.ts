import { test, expect } from '../fixtures';

const SUBMIT_URL = 'aionui-core://trusted/api/gea/sales-plan/submissions';
const CORE_SUBMIT_PATH = '/api/gea/sales-plan/submissions';

type CdpRequest = {
  requestId: string;
  url: string;
  headers: Record<string, string | number>;
};

test.describe('trusted sales-plan Main transport', () => {
  test('keeps the master secret out of Renderer CDP and rejects non-main callers', async ({ page, electronApp }) => {
    const cdp = await page.context().newCDPSession(page);
    const requests = new Map<string, CdpRequest>();
    const extraHeaders = new Map<string, Record<string, string | number>>();
    cdp.on('Network.requestWillBeSent', (event) => {
      requests.set(event.requestId, {
        requestId: event.requestId,
        url: event.request.url,
        headers: event.request.headers,
      });
    });
    cdp.on('Network.requestWillBeSentExtraInfo', (event) => {
      extraHeaders.set(event.requestId, event.headers);
    });
    await cdp.send('Network.enable');

    await electronApp.evaluate(({ session }, submitPath) => {
      const state = globalThis as typeof globalThis & {
        __trustedSalesPlanMainRequests?: Array<{
          kind: 'scheme' | 'core';
          webContentsId?: number;
          hasWebContents: boolean;
          hasFrame: boolean;
          resourceType: string;
        }>;
      };
      state.__trustedSalesPlanMainRequests = [];
      session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        if (details.method === 'POST' && details.url.endsWith(submitPath)) {
          state.__trustedSalesPlanMainRequests?.push({
            kind: details.url.startsWith('http://127.0.0.1:') ? 'core' : 'scheme',
            webContentsId: details.webContentsId,
            hasWebContents: details.webContents !== undefined,
            hasFrame: details.frame !== undefined && details.frame !== null,
            resourceType: details.resourceType,
          });
        }
        callback({ requestHeaders: details.requestHeaders });
      });
    }, CORE_SUBMIT_PATH);

    const result = await page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'e2e-idempotency',
          'X-Request-Id': 'e2e-request',
        },
        body: JSON.stringify({ periodId: '9007199254740993' }),
      });
      return {
        status: response.status,
        transport: response.headers.get('x-aionui-trusted-transport'),
      };
    }, SUBMIT_URL);

    expect(result.transport).toBe('main');
    await expect.poll(() => [...requests.values()].filter((request) => request.url === SUBMIT_URL).length).toBe(1);

    const schemeRequest = [...requests.values()].find((request) => request.url === SUBMIT_URL);
    expect(schemeRequest).toBeDefined();
    const cdpHeaders = {
      ...schemeRequest?.headers,
      ...(schemeRequest ? extraHeaders.get(schemeRequest.requestId) : {}),
    };
    expect(Object.keys(cdpHeaders).map((name) => name.toLowerCase())).not.toContain('x-aioncore-bootstrap-secret');
    if (process.env.AIONCORE_BOOTSTRAP_SECRET) {
      expect(JSON.stringify(cdpHeaders)).not.toContain(process.env.AIONCORE_BOOTSTRAP_SECRET);
    }
    expect(
      [...requests.values()].some(
        (request) => request.url.startsWith('http://127.0.0.1:') && request.url.endsWith(CORE_SUBMIT_PATH)
      )
    ).toBe(false);
    const mainRequests = await electronApp.evaluate(({ session }) => {
      const state = globalThis as typeof globalThis & {
        __trustedSalesPlanMainRequests?: Array<{
          kind: 'scheme' | 'core';
          webContentsId?: number;
          hasWebContents: boolean;
          hasFrame: boolean;
          resourceType: string;
        }>;
      };
      session.defaultSession.webRequest.onBeforeSendHeaders(null);
      return state.__trustedSalesPlanMainRequests ?? [];
    });
    expect(mainRequests).toHaveLength(2);
    expect(mainRequests[0]).toEqual({
      kind: 'scheme',
      webContentsId: expect.any(Number),
      hasWebContents: true,
      hasFrame: true,
      resourceType: 'xhr',
    });
    expect(mainRequests[1]).toEqual({
      kind: 'core',
      hasWebContents: false,
      hasFrame: false,
      resourceType: 'other',
    });

    const subframeResult = await page.evaluate(async (url) => {
      const frame = document.createElement('iframe');
      frame.srcdoc = '<!doctype html><title>subframe</title>';
      const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
      document.body.append(frame);
      await loaded;
      try {
        await frame.contentWindow!.fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'subframe-idempotency',
            'X-Request-Id': 'subframe-request',
          },
          body: '{}',
        });
        return 'unexpected-success';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        frame.remove();
      }
    }, SUBMIT_URL);
    expect(subframeResult).not.toBe('unexpected-success');

    const otherWindowResult = await electronApp.evaluate(async ({ BrowserWindow }, url) => {
      const otherWindow = new BrowserWindow({ show: false });
      try {
        await otherWindow.loadURL('data:text/html,<!doctype html><title>other</title>');
        return await otherWindow.webContents.executeJavaScript(`
          fetch(${JSON.stringify(url)}, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': 'other-window-idempotency',
              'X-Request-Id': 'other-window-request'
            },
            body: '{}'
          }).then(() => 'unexpected-success').catch((error) => String(error && error.message || error))
        `);
      } finally {
        otherWindow.destroy();
      }
    }, SUBMIT_URL);
    expect(otherWindowResult).not.toBe('unexpected-success');

    await cdp.detach();
  });
});
