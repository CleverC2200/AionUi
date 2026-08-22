import { ipcBridge } from '@/common';
import { NotificationActions, type NotificationAction } from '@/common/adapter/notification-inbox';
import type { NotificationActionCommand } from '@/common/types/notification';
import { mutate } from 'swr';

export const NOTIFICATIONS_ACTIVE_KEY_PREFIX = 'notifications.active:';
export const notificationInboxKey = (userId: string): string => `${NOTIFICATIONS_ACTIVE_KEY_PREFIX}${userId}`;
export const fetchActiveNotifications = () => ipcBridge.notificationInbox.list.invoke({ status: 'active' });
export const fetchNotificationDetail = (notificationId: string) =>
  ipcBridge.notificationInbox.get.invoke({ notification_id: notificationId });

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
