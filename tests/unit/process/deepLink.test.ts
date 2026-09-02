import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  emit: vi.fn(),
  claimProvider: vi.fn(),
  acknowledgeProvider: vi.fn(),
  reportFailureProvider: vi.fn(),
}));

const environment = vi.hoisted(() => ({
  available: true,
  environmentId: 'gea.test',
}));

const electronApp = vi.hoisted(() => ({
  getVersion: vi.fn(() => '1.7.2-test'),
  setAsDefaultProtocolClient: vi.fn(() => true),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    deepLink: {
      received: { emit: bridge.emit },
      claimPending: { provider: bridge.claimProvider },
      acknowledge: { provider: bridge.acknowledgeProvider },
      reportFailure: { provider: bridge.reportFailureProvider },
    },
  },
}));

vi.mock('electron', () => ({
  app: electronApp,
}));

vi.mock('@/process/services/gea/GeaEnvironmentService', () => ({
  getGeaEnvironment: () => {
    if (!environment.available) throw new Error('GEA_ENVIRONMENT_NOT_INITIALIZED');
    return { environmentId: environment.environmentId };
  },
}));

import {
  acknowledgeOpenConversation,
  claimPendingOpenConversation,
  findInitialDeepLink,
  getPendingDeepLinkUrl,
  handleDeepLinkUrl,
  parseDeepLinkUrl,
  registerDefaultProtocolClient,
  reportOpenConversationFailure,
  setDeepLinkMainWindow,
} from '@/process/utils/deepLink';
import { initDeepLinkBridge } from '@/process/bridge/deepLinkBridge';

const REFERENCE = 'nav_0123456789abcdef';

describe('deepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    environment.available = true;
    environment.environmentId = 'gea.test';
    acknowledgeOpenConversation(REFERENCE);
    setDeepLinkMainWindow({
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, isLoadingMainFrame: () => false },
    } as never);
  });

  it('does not register the bare Electron bundle as the protocol client during macOS development', () => {
    registerDefaultProtocolClient(
      true,
      'darwin',
      '/Applications/Electron.app/Contents/MacOS/Electron',
      '/repo/out/main'
    );

    expect(electronApp.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  it.each(['win32', 'linux'] as const)('keeps explicit protocol registration for %s development', (platform) => {
    registerDefaultProtocolClient(true, platform, '/runtime/electron', '/repo/out/main');

    expect(electronApp.setAsDefaultProtocolClient).toHaveBeenCalledWith('aionui', '/runtime/electron', [
      '/repo/out/main',
    ]);
  });

  it('registers the packaged macOS application as the protocol client', () => {
    registerDefaultProtocolClient(false, 'darwin', '/Applications/GEAUi.app/Contents/MacOS/GEAUi', '/unused');

    expect(electronApp.setAsDefaultProtocolClient).toHaveBeenCalledWith('aionui');
  });

  it('parses the versioned open-conversation action without accepting a route', () => {
    expect(parseDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1&profile=gea.test`)).toEqual({
      action: 'open-conversation',
      params: { ref: REFERENCE, v: '1', profile: 'gea.test' },
    });

    expect(parseDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1&route=/conversation/c1`)).toBeNull();
  });

  it.each([
    `aionui://open-conversation?ref=${REFERENCE}&ref=nav_abcdef0123456789&v=1`,
    `aionui://open-conversation?ref=${REFERENCE}&v=2`,
    `aionui://open-conversation?ref=unsafe~reference&v=1`,
    `aionui://open-conversation?ref=${'a'.repeat(513)}&v=1`,
    `aionui://open-conversation/path?ref=${REFERENCE}&v=1`,
    `aionui://open-conversation?ref=${REFERENCE}%ZZ&v=1`,
    `aionui://user@open-conversation?ref=${REFERENCE}&v=1`,
  ])('rejects an unsafe open-conversation URL: %s', (url) => {
    expect(parseDeepLinkUrl(url)).toBeNull();
  });

  it('rejects unknown legacy actions', () => {
    expect(parseDeepLinkUrl('aionui://unknown-action?ref=anything')).toBeNull();
  });

  it('creates a typed pending intent directly from cold-start argv', () => {
    expect(findInitialDeepLink(['GEAUi', `aionui://open-conversation?ref=${REFERENCE}&v=1`])).toEqual({
      payload: { action: 'open-conversation', params: { ref: REFERENCE, v: '1' } },
      url: `aionui://open-conversation?ref=${REFERENCE}&v=1`,
    });
  });

  it('keeps legacy add-provider data decoding compatible', () => {
    const data = Buffer.from(JSON.stringify({ base_url: 'https://example.com/v1', api_key: 'key' })).toString('base64');
    expect(parseDeepLinkUrl(`aionui://provider/add?v=1&data=${encodeURIComponent(data)}`)).toEqual({
      action: 'provider/add',
      params: { v: '1', base_url: 'https://example.com/v1', api_key: 'key' },
    });
  });

  it('rejects a profile that is not the configured GEA environment', () => {
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1&profile=gea.prod`);

    expect(bridge.emit).not.toHaveBeenCalled();
    expect(claimPendingOpenConversation()).toBeNull();
  });

  it('logs only a hashed reference and stable metadata for accepted navigation intents', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1&profile=gea.test`);

    expect(info).toHaveBeenCalledWith(
      '[DeepLink]',
      expect.objectContaining({
        client_version: '1.7.2-test',
        platform: process.platform,
        reference_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        result: 'accepted',
        schema_version: 1,
        stage: 'ingress',
      })
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain(REFERENCE);
    expect(JSON.stringify(info.mock.calls)).not.toContain('aionui://');
  });

  it('retains an open-conversation intent until the matching reference is acknowledged', () => {
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);

    expect(bridge.emit).toHaveBeenCalledWith({
      action: 'open-conversation',
      params: { ref: REFERENCE, v: '1' },
    });
    expect(claimPendingOpenConversation()?.params.ref).toBe(REFERENCE);
    expect(acknowledgeOpenConversation('nav_other_0123456789')).toBe(false);
    expect(claimPendingOpenConversation()).toBeNull();
    expect(acknowledgeOpenConversation(REFERENCE)).toBe(true);
    expect(claimPendingOpenConversation()).toBeNull();
  });

  it('keeps a broadcast intent claimable until an authenticated renderer confirms receipt', () => {
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);

    expect(bridge.emit).toHaveBeenCalledOnce();
    expect(claimPendingOpenConversation()?.params.ref).toBe(REFERENCE);
    expect(claimPendingOpenConversation()).toBeNull();
    expect(acknowledgeOpenConversation(REFERENCE)).toBe(true);
  });

  it('holds a profiled intent until the configured GEA environment is available', () => {
    environment.available = false;
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1&profile=gea.test`);

    expect(bridge.emit).not.toHaveBeenCalled();
    expect(claimPendingOpenConversation()).toBeNull();

    environment.available = true;
    expect(claimPendingOpenConversation()?.params.ref).toBe(REFERENCE);
    expect(acknowledgeOpenConversation(REFERENCE)).toBe(true);
  });

  it('finishes the active intent before broadcasting the next distinct intent', () => {
    const newerReference = 'nav_fedcba9876543210';
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${newerReference}&v=1`);

    expect(bridge.emit).toHaveBeenCalledTimes(1);
    expect(bridge.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ ref: REFERENCE }) })
    );
    expect(acknowledgeOpenConversation(REFERENCE)).toBe(true);
    expect(bridge.emit).toHaveBeenCalledTimes(2);
    expect(bridge.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ ref: newerReference }) })
    );
    expect(acknowledgeOpenConversation(newerReference)).toBe(true);
  });

  it('keeps distinct queued intents in bounded FIFO order', () => {
    const middleReference = 'nav_1111111111111111';
    const newestReference = 'nav_2222222222222222';
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${middleReference}&v=1`);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${newestReference}&v=1`);

    expect(bridge.emit).toHaveBeenCalledTimes(1);
    expect(acknowledgeOpenConversation(REFERENCE)).toBe(true);
    expect(bridge.emit).toHaveBeenCalledTimes(2);
    expect(bridge.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ ref: middleReference }) })
    );
    expect(acknowledgeOpenConversation(middleReference)).toBe(true);
    expect(bridge.emit).toHaveBeenCalledTimes(3);
    expect(bridge.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ ref: newestReference }) })
    );
    expect(acknowledgeOpenConversation(newestReference)).toBe(true);
  });

  it('deduplicates active and queued navigation references', () => {
    const queuedReference = 'nav_deduplicated_0001';
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${queuedReference}&v=1`);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${queuedReference}&v=1`);

    expect(bridge.emit).toHaveBeenCalledTimes(1);
    expect(acknowledgeOpenConversation(REFERENCE)).toBe(true);
    expect(bridge.emit).toHaveBeenCalledTimes(2);
    expect(acknowledgeOpenConversation(queuedReference)).toBe(true);
    expect(claimPendingOpenConversation()).toBeNull();
  });

  it('caps the active plus queued navigation intents at sixteen', () => {
    const references = Array.from({ length: 17 }, (_, index) => `nav_queue_${index.toString().padStart(2, '0')}`);
    for (const reference of references) {
      handleDeepLinkUrl(`aionui://open-conversation?ref=${reference}&v=1`);
    }

    for (const reference of references.slice(0, 16)) {
      expect(acknowledgeOpenConversation(reference)).toBe(true);
    }
    expect(acknowledgeOpenConversation(references[16])).toBe(false);
    expect(claimPendingOpenConversation()).toBeNull();
  });

  it('expires stale active intents before promoting the next FIFO item', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
      const nextReference = 'nav_after_expiry_0001';
      handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);
      vi.setSystemTime(new Date('2026-09-01T00:01:00Z'));
      handleDeepLinkUrl(`aionui://open-conversation?ref=${nextReference}&v=1`);

      vi.setSystemTime(new Date('2026-09-01T00:10:00Z'));
      expect(claimPendingOpenConversation()?.params.ref).toBe(nextReference);
      expect(acknowledgeOpenConversation(nextReference)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a transiently failed active intent ahead of the newest queued intent', () => {
    const middleReference = 'nav_3333333333333333';
    const newestReference = 'nav_4444444444444444';
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${middleReference}&v=1`);

    expect(reportOpenConversationFailure(REFERENCE, 'DEEP_LINK_RESOLVE_FAILED')).toBe(true);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${newestReference}&v=1`);

    expect(bridge.emit).toHaveBeenCalledTimes(2);
    expect(claimPendingOpenConversation()?.params.ref).toBe(REFERENCE);
    expect(acknowledgeOpenConversation(REFERENCE)).toBe(true);
    expect(bridge.emit).toHaveBeenCalledTimes(3);
    expect(bridge.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ ref: middleReference }) })
    );
    expect(acknowledgeOpenConversation(middleReference)).toBe(true);
    expect(bridge.emit).toHaveBeenCalledTimes(4);
    expect(bridge.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ ref: newestReference }) })
    );
    expect(acknowledgeOpenConversation(newestReference)).toBe(true);
  });

  it('retains an intent without broadcasting to a renderer that is reloading', () => {
    setDeepLinkMainWindow({
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, isLoadingMainFrame: () => true },
    } as never);

    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);

    expect(bridge.emit).not.toHaveBeenCalled();
    setDeepLinkMainWindow({
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, isLoadingMainFrame: () => false },
    } as never);
    expect(claimPendingOpenConversation()?.params.ref).toBe(REFERENCE);
    expect(getPendingDeepLinkUrl()).toBeNull();
    expect(claimPendingOpenConversation()).toBeNull();
  });

  it('registers native claim and acknowledgement providers', async () => {
    initDeepLinkBridge();
    expect(bridge.claimProvider).toHaveBeenCalledOnce();
    expect(bridge.acknowledgeProvider).toHaveBeenCalledOnce();
    expect(bridge.reportFailureProvider).toHaveBeenCalledOnce();

    setDeepLinkMainWindow({
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, isLoadingMainFrame: () => true },
    } as never);
    handleDeepLinkUrl(`aionui://open-conversation?ref=${REFERENCE}&v=1`);
    const claim = bridge.claimProvider.mock.calls[0][0] as () => Promise<unknown>;
    const acknowledge = bridge.acknowledgeProvider.mock.calls[0][0] as (params: {
      navigation_reference: string;
    }) => Promise<boolean>;
    await expect(claim()).resolves.toMatchObject({ params: { ref: REFERENCE } });
    await expect(acknowledge({ navigation_reference: REFERENCE })).resolves.toBe(true);
  });
});
