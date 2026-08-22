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
  clearScope: vi.fn(),
  show: vi.fn(),
  changedCallback: undefined as
    | ((payload?: { revision: string; reason: 'snapshot'; notification_id?: string; trace_id?: string }) => void)
    | undefined,
  reconnectedCallback: undefined as (() => void) | undefined,
  offChanged: vi.fn(),
  offReconnected: vi.fn(),
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@/renderer/services/notificationInbox', () => ({
  fetchActiveNotifications: state.fetch,
  clearNotificationScopeCache: state.clearScope,
  notificationInboxKey: (userId: string) => `notifications.active.test:${userId}`,
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    notificationInbox: {
      changed: {
        on: (callback: NonNullable<typeof state.changedCallback>) => {
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
      scope_id: 'user-1',
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
    const previousSignal = state.fetch.mock.calls[0][0] as AbortSignal;

    state.auth = { status: 'authenticated', user: { id: 'user-2' } };
    rerender();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(previousSignal.aborted).toBe(true));
    expect(state.clearScope).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(state.show).not.toHaveBeenCalled();
  });

  it('runs one follow-up refresh when a changed revision arrives during an in-flight refresh', async () => {
    let resolveSecond: ((value: ReturnType<typeof snapshot>) => void) | undefined;
    state.fetch
      .mockResolvedValueOnce(snapshot([item('notification-1', 'v1')]))
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof snapshot>>((resolve) => {
            resolveSecond = resolve;
          })
      )
      .mockResolvedValueOnce(snapshot([item('notification-1', 'v3')]));
    renderHook(() => useNotificationInboxSync(), { wrapper });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));

    state.changedCallback?.({ revision: 'v2', reason: 'snapshot', trace_id: 'trace-safe' });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    state.changedCallback?.({ revision: 'v3', reason: 'snapshot', notification_id: 'notification-1' });
    resolveSecond?.(snapshot([item('notification-1', 'v2')]));

    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3), { timeout: 1_000 });
  });

  it('refreshes on reconnect without requiring a notification.changed event', async () => {
    state.fetch.mockResolvedValue(snapshot([item('notification-1', 'v1')]));
    renderHook(() => useNotificationInboxSync(), { wrapper });
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));

    state.reconnectedCallback?.();

    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2), { timeout: 1_000 });
  });
});
