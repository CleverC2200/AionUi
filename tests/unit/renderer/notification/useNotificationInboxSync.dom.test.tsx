import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import { useNotificationInboxSync } from '@/renderer/hooks/system/notification/useNotificationInboxSync';

const state = vi.hoisted(() => ({
  auth: { status: 'authenticated', user: { id: 'user-1' } } as {
    status: 'authenticated' | 'unauthenticated';
    user: { id: string } | null;
  },
  fetch: vi.fn(),
  show: vi.fn(),
  changedCallback: undefined as (() => void) | undefined,
  reconnectedCallback: undefined as (() => void) | undefined,
  offChanged: vi.fn(),
  offReconnected: vi.fn(),
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@/renderer/services/notificationInbox', () => ({
  fetchActiveNotifications: state.fetch,
  notificationInboxKey: (userId: string) => `notifications.active.test:${userId}`,
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    notificationInbox: {
      changed: {
        on: (callback: () => void) => {
          state.changedCallback = callback;
          return state.offChanged;
        },
      },
    },
    realtime: {
      reconnected: {
        on: (callback: () => void) => {
          state.reconnectedCallback = callback;
          return state.offReconnected;
        },
      },
    },
    notification: { show: { invoke: state.show } },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));

const item = (id: string, version: string) => ({
  id,
  version,
  status: 'unread' as const,
  kind: 'event' as const,
  severity: 'warning' as const,
  title: 'Never used by the native notification',
  dismissible: true,
  source: 'gea.workflow',
  target: { type: 'conversation' as const, conversationId: `conversation-${id}` },
  created_at: '2026-08-22T08:00:00Z',
});

const snapshot = (items: ReturnType<typeof item>[]) => ({
  revision: items.map((value) => value.version).join('-'),
  items,
  sync_state: 'fresh' as const,
  last_synced_at: '2026-08-22T08:00:01Z',
  failure_codes: [],
});

const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

describe('useNotificationInboxSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.show.mockResolvedValue(undefined);
    state.auth = { status: 'authenticated', user: { id: 'user-1' } };
    state.changedCallback = undefined;
    state.reconnectedCallback = undefined;
  });

  afterEach(() => {
    state.changedCallback = undefined;
    state.reconnectedCallback = undefined;
  });

  it('debounces invalidations, reconciles a full snapshot and notifies each new version once', async () => {
    state.fetch
      .mockResolvedValueOnce(snapshot([item('notification-1', 'v1')]))
      .mockResolvedValueOnce(snapshot([item('notification-1', 'v1'), item('notification-2', 'v1')]))
      .mockResolvedValue(
        snapshot([
          item('notification-1', 'v1'),
          item('notification-2', 'v1'),
          { ...item('notification-info', 'v1'), severity: 'info' as const },
        ])
      );
    const { unmount } = renderHook(() => useNotificationInboxSync(), { wrapper });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));

    state.changedCallback?.();
    state.changedCallback?.();
    state.reconnectedCallback?.();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    await waitFor(() => expect(state.show).toHaveBeenCalledTimes(1));
    expect(state.show).toHaveBeenCalledWith({
      title: 'conversation.notifications.nativeTitle',
      body: 'conversation.notifications.nativeBody:1',
      notification_id: 'notification-2',
      notification_version: 'v1',
      target: { type: 'conversation', conversationId: 'conversation-notification-2' },
    });

    state.changedCallback?.();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3), { timeout: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.show).toHaveBeenCalledTimes(1);

    unmount();
    expect(state.offChanged).toHaveBeenCalledTimes(1);
    expect(state.offReconnected).toHaveBeenCalledTimes(1);
  });

  it('uses a new SWR scope and baselines without notifying after an account switch', async () => {
    state.fetch.mockResolvedValue(snapshot([item('notification-1', 'v1')]));
    const { rerender } = renderHook(() => useNotificationInboxSync(), { wrapper });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));

    state.auth = { status: 'authenticated', user: { id: 'user-2' } };
    rerender();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    expect(state.show).not.toHaveBeenCalled();
  });
});
