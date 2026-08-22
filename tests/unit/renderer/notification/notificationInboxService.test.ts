import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    notificationInbox: {
      list: { invoke: state.list },
      get: { invoke: state.detail },
      markRead: { invoke: vi.fn() },
      dismiss: { invoke: vi.fn() },
    },
  },
}));

import {
  clearNotificationScopeCache,
  fetchActiveNotifications,
  fetchNotificationDetail,
} from '@/renderer/services/notificationInbox';

describe('notificationInbox service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a late list response after its identity scope is aborted', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    state.list.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    const controller = new AbortController();
    const request = fetchActiveNotifications(controller.signal);

    controller.abort();
    resolveRequest?.({ revision: 'old-user-revision', items: [] });

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a late detail response without logging its content after scope disposal', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    state.detail.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    const controller = new AbortController();
    const request = fetchNotificationDetail('notification-1', controller.signal);

    controller.abort();
    resolveRequest?.({ id: 'notification-1', body: 'must-not-enter-cache' });

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('clears both active and detail cache keys for the previous identity', async () => {
    const cacheMutate = vi.fn().mockResolvedValue(undefined);

    await clearNotificationScopeCache('user-1', cacheMutate as never);

    expect(cacheMutate).toHaveBeenCalledTimes(2);
    const detailMatcher = cacheMutate.mock.calls[0][0] as (key: string) => boolean;
    const activeMatcher = cacheMutate.mock.calls[1][0] as (key: string) => boolean;
    expect(detailMatcher('notifications.detail:user-1:notification-1:v1')).toBe(true);
    expect(detailMatcher('notifications.detail:user-2:notification-1:v1')).toBe(false);
    expect(activeMatcher('notifications.active:user-1')).toBe(true);
    expect(activeMatcher('notifications.active:user-2')).toBe(false);
  });
});
