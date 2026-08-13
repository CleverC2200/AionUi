import { describe, expect, it, vi } from 'vitest';

const updaterMocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
}));

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({ provider: vi.fn(), invoke: vi.fn() })),
    buildEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn() })),
  },
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), getVersion: vi.fn(() => '1.0.0'), isPackaged: true },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    setFeedURL: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: updaterMocks.checkForUpdates,
    downloadUpdate: updaterMocks.downloadUpdate,
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { ipcBridge } from '@/common';
import { initUpdateBridge } from '@process/bridge/updateBridge';

describe('GEA update bridge policy', () => {
  it('rejects official checks and downloads before any network work starts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    initUpdateBridge();

    const check = vi.mocked(ipcBridge.update.check.provider).mock.calls.at(-1)?.[0];
    const download = vi.mocked(ipcBridge.update.download.provider).mock.calls.at(-1)?.[0];
    const autoCheck = vi.mocked(ipcBridge.autoUpdate.check.provider).mock.calls.at(-1)?.[0];
    if (!check || !download || !autoCheck) throw new Error('update handlers were not registered');

    await expect(check({})).resolves.toMatchObject({
      success: false,
      msg: 'GEA update service is not configured',
    });
    await expect(download({ url: 'https://static.aionui.com/releases/test.zip' })).resolves.toMatchObject({
      success: false,
      msg: 'GEA update service is not configured',
    });
    await expect(autoCheck({})).resolves.toMatchObject({
      success: false,
      msg: 'GEA update service is not configured',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updaterMocks.checkForUpdates).not.toHaveBeenCalled();
    expect(updaterMocks.downloadUpdate).not.toHaveBeenCalled();
  });
});
