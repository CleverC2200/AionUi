import React, { type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const fixtures = vi.hoisted(() => ({
  changedListeners: [] as Array<() => void>,
  reconnectListeners: [] as Array<() => void>,
  listInvoke: vi.fn(),
  showInvoke: vi.fn(),
  isDesktop: true,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    interactionRequest: {
      list: { invoke: fixtures.listInvoke },
      changed: {
        on: (listener: () => void) => {
          fixtures.changedListeners.push(listener);
          return vi.fn();
        },
      },
    },
    realtime: {
      reconnected: {
        on: (listener: () => void) => {
          fixtures.reconnectListeners.push(listener);
          return vi.fn();
        },
      },
    },
    notification: {
      show: { invoke: fixtures.showInvoke },
    },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => fixtures.isDesktop }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) => `${key}:${options?.count ?? ''}` }),
}));

import { useInteractionRequestSync } from '@/renderer/hooks/system/notification/useInteractionRequestSync';

const emptySnapshot = {
  revision: 'r1',
  sync_state: 'complete' as const,
  failed_session_count: 0,
  failure_codes: [],
  items: [],
};

const pendingSnapshot = {
  ...emptySnapshot,
  revision: 'r2',
  items: [
    {
      id: 'request-1',
      version: 'v1',
      kind: 'permission' as const,
      status: 'pending' as const,
      title: 'Confirm submission',
      source: { type: 'business_system' as const, label: 'GEA' },
      conversation_id: 'conversation-1',
      allowed_actions: ['proceed_once'],
      stale: false,
    },
  ],
};

const Wrapper = ({ children }: PropsWithChildren) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

describe('useInteractionRequestSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.changedListeners.length = 0;
    fixtures.reconnectListeners.length = 0;
    fixtures.isDesktop = true;
  });

  it('refreshes globally and notifies once when a new actionable request appears', async () => {
    fixtures.listInvoke
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce(pendingSnapshot)
      .mockResolvedValueOnce(pendingSnapshot);
    renderHook(() => useInteractionRequestSync(), { wrapper: Wrapper });

    await waitFor(() => expect(fixtures.listInvoke).toHaveBeenCalledTimes(1));
    expect(fixtures.showInvoke).not.toHaveBeenCalled();
    expect(fixtures.changedListeners).toHaveLength(1);
    expect(fixtures.reconnectListeners).toHaveLength(1);

    act(() => fixtures.changedListeners[0]?.());
    await waitFor(() => expect(fixtures.listInvoke).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(fixtures.showInvoke).toHaveBeenCalledWith({
        title: 'GEAUi',
        body: 'conversation.attention.notification:1',
        conversation_id: 'conversation-1',
      })
    );

    act(() => fixtures.reconnectListeners[0]?.());
    await waitFor(() => expect(fixtures.listInvoke).toHaveBeenCalledTimes(3));
    expect(fixtures.showInvoke).toHaveBeenCalledTimes(1);
  });

  it('keeps the cache fresh in WebUI without invoking the desktop notification bridge', async () => {
    fixtures.isDesktop = false;
    fixtures.listInvoke.mockResolvedValueOnce(emptySnapshot).mockResolvedValueOnce(pendingSnapshot);
    renderHook(() => useInteractionRequestSync(), { wrapper: Wrapper });

    await waitFor(() => expect(fixtures.listInvoke).toHaveBeenCalledTimes(1));
    act(() => fixtures.changedListeners[0]?.());
    await waitFor(() => expect(fixtures.listInvoke).toHaveBeenCalledTimes(2));
    expect(fixtures.showInvoke).not.toHaveBeenCalled();
  });
});
