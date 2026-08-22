import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test';
import { invokeBridge } from '../../helpers';
import { startMockGeaLarkServer, type MockGeaLarkServer } from '../../helpers/mock-gea-lark-server';

type LarkStatus = {
  success: boolean;
  data?: {
    authenticated: boolean;
    user?: { id: string; realname: string; username: string };
  };
};

const projectRoot = path.resolve(__dirname, '../../../..');
const backendBinary = process.env.AIONUI_BACKEND_BIN ?? process.env.AIONUI_AIONCORE_BINARY ?? '';

function storedSessionPath(userDataDir: string, baseUrl: string): string {
  const normalized = new URL(baseUrl).toString().replace(/\/$/, '');
  const environmentKey = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return path.join(userDataDir, `lark-auth-session-${environmentKey}.bin`);
}

async function resolveMainWindow(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((window) => !window.url().startsWith('devtools://'));
  if (existing) {
    await existing.waitForLoadState('domcontentloaded');
    return existing;
  }
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    // Intentionally serial: each bounded wait observes the next Electron window event.
    // eslint-disable-next-line no-await-in-loop
    const window = await app.waitForEvent('window', { timeout: 1_000 }).catch(() => null);
    if (window && !window.url().startsWith('devtools://')) {
      // eslint-disable-next-line no-await-in-loop
      await window.waitForLoadState('domcontentloaded');
      return window;
    }
  }
  throw new Error('desktop Lark restart E2E did not receive a main window');
}

async function launchDesktop(
  userDataDir: string,
  mockGea: MockGeaLarkServer
): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      AIONUI_BACKEND_BIN: backendBinary,
      AIONUI_CDP_PORT: '0',
      AIONUI_DISABLE_AUTO_UPDATE: '1',
      AIONUI_DISABLE_DEVTOOLS: '1',
      AIONUI_E2E_TEST: '1',
      AIONUI_E2E_USER_DATA_DIR: userDataDir,
      AIONUI_GEA_BASE_URL: mockGea.baseUrl,
      AIONUI_GEA_REQUIRE_AUTH: '1',
      NODE_ENV: 'development',
    },
    timeout: 90_000,
  });
  return { app, page: await resolveMainWindow(app) };
}

async function readStatus(page: Page): Promise<LarkStatus> {
  return invokeBridge<LarkStatus>(page, 'lark-auth.status');
}

test.describe.serial('Desktop Lark credential restart boundary', () => {
  test.skip(process.platform === 'linux', 'Linux CI basic_text safeStorage is intentionally rejected');
  test.skip(!backendBinary || !fs.existsSync(backendBinary), 'AIONUI_BACKEND_BIN must point to a real AionCore binary');

  test('restores a valid encrypted platform credential and clears it after upstream rejection', async () => {
    test.setTimeout(180_000);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-issue133-desktop-'));
    const mockGea = await startMockGeaLarkServer();
    const sessionPath = storedSessionPath(userDataDir, mockGea.baseUrl);
    let desktop: Awaited<ReturnType<typeof launchDesktop>> | null = null;

    try {
      desktop = await launchDesktop(userDataDir, mockGea);
      await expect
        .poll(async () => (await readStatus(desktop?.page as Page)).data?.authenticated, { timeout: 60_000 })
        .toBe(true);
      expect(mockGea.counters.qrRequests).toBeGreaterThan(0);
      expect(mockGea.counters.tokenPolls).toBeGreaterThan(0);

      const browserStorage = await desktop.page.evaluate(() => ({
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      }));
      expect(JSON.stringify(browserStorage)).not.toContain(mockGea.tokenSentinel);

      await desktop.app.close();
      desktop = null;
      const encrypted = fs.readFileSync(sessionPath);
      expect(encrypted.toString('utf8')).not.toContain(mockGea.tokenSentinel);
      expect(fs.statSync(sessionPath).mode & 0o077).toBe(0);

      const qrRequestsBeforeRestart = mockGea.counters.qrRequests;
      const tokenPollsBeforeRestart = mockGea.counters.tokenPolls;
      const userInfoBeforeRestart = mockGea.counters.userInfoRequests;
      desktop = await launchDesktop(userDataDir, mockGea);
      await expect
        .poll(async () => (await readStatus(desktop?.page as Page)).data?.authenticated, { timeout: 60_000 })
        .toBe(true);
      const restored = await readStatus(desktop.page);
      expect(restored.data?.user?.id).toBe('issue133-desktop-user');
      expect(mockGea.counters.qrRequests).toBe(qrRequestsBeforeRestart);
      expect(mockGea.counters.tokenPolls).toBe(tokenPollsBeforeRestart);
      expect(mockGea.counters.userInfoRequests).toBeGreaterThan(userInfoBeforeRestart);

      mockGea.invalidateAccessToken();
      mockGea.setQrAuthenticationEnabled(false);
      await desktop.app.close();
      desktop = await launchDesktop(userDataDir, mockGea);
      await expect
        .poll(async () => (await readStatus(desktop?.page as Page)).data?.authenticated, { timeout: 60_000 })
        .toBe(false);
      await expect.poll(() => fs.existsSync(sessionPath), { timeout: 10_000 }).toBe(false);
    } finally {
      await desktop?.app.close().catch(() => {});
      await mockGea.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
