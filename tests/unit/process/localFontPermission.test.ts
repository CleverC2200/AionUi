import { describe, expect, it } from 'vitest';
import { shouldGrantPermissionRequest } from '@process/utils/localFontPermission';

const webContentsAt = (url: string) => ({ getURL: () => url });

describe('shouldGrantPermissionRequest', () => {
  it('preserves default grants for named Electron permissions', () => {
    const requester = webContentsAt('https://example.com');
    expect(
      shouldGrantPermissionRequest(requester, undefined, 'media', {
        isMainFrame: false,
        requestingUrl: requester.getURL(),
      })
    ).toBe(true);
  });

  it('allows an unknown Local Font Access request from the current top-level app renderer', () => {
    const mainRenderer = webContentsAt('file:///app/index.html');
    expect(
      shouldGrantPermissionRequest(mainRenderer, mainRenderer, 'unknown', {
        isMainFrame: true,
        requestingUrl: mainRenderer.getURL(),
      })
    ).toBe(true);
  });

  it('rejects unknown requests from subframes, other contents, or stale pages', () => {
    const mainRenderer = webContentsAt('file:///app/index.html');
    const otherContents = webContentsAt('https://example.com');

    expect(
      shouldGrantPermissionRequest(mainRenderer, mainRenderer, 'unknown', {
        isMainFrame: false,
        requestingUrl: mainRenderer.getURL(),
      })
    ).toBe(false);
    expect(
      shouldGrantPermissionRequest(otherContents, mainRenderer, 'unknown', {
        isMainFrame: true,
        requestingUrl: otherContents.getURL(),
      })
    ).toBe(false);
    expect(
      shouldGrantPermissionRequest(mainRenderer, mainRenderer, 'unknown', {
        isMainFrame: true,
        requestingUrl: 'file:///app/old.html',
      })
    ).toBe(false);
  });
});
