import { ipcBridge } from '@/common';
import { fetchActiveNotifications, notificationInboxKey } from '@/renderer/services/notificationInbox';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

export const useNotificationInboxSync = (): void => {
  const { t } = useTranslation();
  const { status, user } = useAuth();
  const knownVersionsRef = useRef<Map<string, string> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { data, mutate } = useSWR(
    status === 'authenticated' && user ? notificationInboxKey(user.id) : null,
    fetchActiveNotifications
  );

  useEffect(() => {
    knownVersionsRef.current = null;
  }, [user?.id]);

  useEffect(() => {
    const refresh = (): void => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => void mutate(), 150);
    };
    const offChanged = ipcBridge.notificationInbox.changed.on(refresh);
    const offReconnected = ipcBridge.realtime.reconnected.on(refresh);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      offChanged();
      offReconnected();
    };
  }, [mutate]);

  useEffect(() => {
    if (!data || data.sync_state !== 'fresh') return;
    const known = knownVersionsRef.current;
    if (!known) {
      knownVersionsRef.current = new Map(data.items.map((item) => [item.id, item.version]));
      return;
    }
    const added = data.items.filter((item) => item.status === 'unread' && known.get(item.id) !== item.version);
    knownVersionsRef.current = new Map(data.items.map((item) => [item.id, item.version]));
    const nativeEligible = added.filter(
      (item) => item.severity === 'warning' || item.severity === 'critical' || item.kind === 'action_required'
    );
    if (nativeEligible.length === 0 || !isElectronDesktop()) return;
    const first = nativeEligible[0];
    void ipcBridge.notification.show
      .invoke({
        title: t('conversation.notifications.nativeTitle'),
        body: t('conversation.notifications.nativeBody', { count: nativeEligible.length }),
        notification_id: first.id,
        notification_version: first.version,
        target: first.target,
      })
      .catch(() => {
        console.warn('[NotificationInbox] native notification failed', {
          notification_id: first.id,
          notification_version: first.version,
          target_type: first.target.type,
        });
      });
  }, [data, t]);
};
