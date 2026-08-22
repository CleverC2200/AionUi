import { ipcBridge } from '@/common';
import { NotificationActions, type NotificationAction } from '@/common/adapter/notification-inbox';
import type { NotificationActionCommand } from '@/common/types/notification';
import { mutate } from 'swr';

export const NOTIFICATIONS_ACTIVE_KEY_PREFIX = 'notifications.active:';
export const notificationInboxKey = (userId: string): string => `${NOTIFICATIONS_ACTIVE_KEY_PREFIX}${userId}`;

const rejectAbortedScope = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  const error = new Error('Notification request scope changed');
  error.name = 'AbortError';
  throw error;
};

export const fetchActiveNotifications = async (signal?: AbortSignal) => {
  rejectAbortedScope(signal);
  const list = await ipcBridge.notificationInbox.list.invoke({ status: 'active' });
  rejectAbortedScope(signal);
  return list;
};

export const fetchNotificationDetail = async (notificationId: string, signal?: AbortSignal) => {
  try {
    rejectAbortedScope(signal);
    const detail = await ipcBridge.notificationInbox.get.invoke({ notification_id: notificationId });
    rejectAbortedScope(signal);
    console.info('[NotificationInbox] detail loaded', { notification_id: notificationId, result: 'succeeded' });
    return detail;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('[NotificationInbox] detail failed', { notification_id: notificationId, result: 'failed' });
    throw error;
  }
};

export const clearNotificationDetailCache = async (
  userId: string,
  cacheMutate: typeof mutate = mutate
): Promise<void> => {
  const detailPrefix = `notifications.detail:${userId}:`;
  await cacheMutate((key) => typeof key === 'string' && key.startsWith(detailPrefix), undefined, {
    revalidate: false,
  });
};

export const clearNotificationScopeCache = async (
  userId: string,
  cacheMutate: typeof mutate = mutate
): Promise<void> => {
  const activeKey = notificationInboxKey(userId);
  await clearNotificationDetailCache(userId, cacheMutate);
  await cacheMutate((key) => key === activeKey, undefined, {
    revalidate: false,
  });
};

const submit = (action: NotificationAction, notificationId: string, command: NotificationActionCommand) =>
  action === 'read'
    ? ipcBridge.notificationInbox.markRead.invoke({ notification_id: notificationId, ...command })
    : ipcBridge.notificationInbox.dismiss.invoke({ notification_id: notificationId, ...command });

export const notificationActions = new NotificationActions({
  submit,
  refresh: async (scopeId) => {
    await mutate(notificationInboxKey(scopeId));
  },
});
