import { ipcBridge } from '@/common';
import {
  clearNotificationScopeCache,
  fetchActiveNotifications,
  notificationInboxKey,
} from '@/renderer/services/notificationInbox';
import type { NotificationChangedPayload } from '@/common/types/notification';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

export const useNotificationInboxSync = (): void => {
  const { t } = useTranslation();
  const { status, user } = useAuth();
  const { mutate: mutateCache } = useSWRConfig();
  const knownVersionsRef = useRef<Map<string, string> | null>(null);
  const previousUserIdRef = useRef<string | undefined>(undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshRunningRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const expectedRevisionRef = useRef<string | undefined>(undefined);
  const expectedTraceIdRef = useRef<string | undefined>(undefined);
  const requestController = useMemo(() => new AbortController(), [user?.id]);
  const { data, mutate } = useSWR(status === 'authenticated' && user ? notificationInboxKey(user.id) : null, () =>
    fetchActiveNotifications(requestController.signal)
  );

  useEffect(() => () => requestController.abort(), [requestController]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    if (previousUserId && previousUserId !== user?.id) {
      void clearNotificationScopeCache(previousUserId, mutateCache);
    }
    previousUserIdRef.current = user?.id;
    knownVersionsRef.current = null;
  }, [mutateCache, user?.id]);

  useEffect(() => {
    const runRefresh = async (): Promise<void> => {
      if (refreshRunningRef.current) {
        refreshQueuedRef.current = true;
        return;
      }
      refreshRunningRef.current = true;
      let lastTraceId = '';
      try {
        do {
          refreshQueuedRef.current = false;
          const expectedRevision = expectedRevisionRef.current;
          const traceId = expectedTraceIdRef.current;
          lastTraceId = traceId ?? '';
          expectedRevisionRef.current = undefined;
          expectedTraceIdRef.current = undefined;
          // oxlint-disable-next-line eslint/no-await-in-loop -- refreshes must stay serialized to preserve revision order
          const refreshed = await mutate();
          console.info('[NotificationInbox] refresh completed', {
            revision: refreshed?.revision ?? '',
            trace_id: traceId ?? '',
            result: 'succeeded',
          });
          if (expectedRevision && refreshed?.revision !== expectedRevision) {
            refreshQueuedRef.current = true;
          }
        } while (refreshQueuedRef.current);
      } catch {
        console.warn('[NotificationInbox] refresh failed', { trace_id: lastTraceId, result: 'failed' });
      } finally {
        refreshRunningRef.current = false;
      }
    };
    const refresh = (reason: 'changed' | 'reconnected', payload?: NotificationChangedPayload): void => {
      if (payload?.revision) expectedRevisionRef.current = payload.revision;
      if (payload?.trace_id) expectedTraceIdRef.current = payload.trace_id;
      console.info('[NotificationInbox] refresh scheduled', {
        reason,
        revision: payload?.revision ?? '',
        notification_id: payload?.notification_id ?? '',
        trace_id: payload?.trace_id ?? '',
      });
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => void runRefresh(), 150);
    };
    const offChanged = ipcBridge.notificationInbox.changed.on((payload) => refresh('changed', payload));
    const offReconnected = ipcBridge.realtime.reconnected.on(() => refresh('reconnected'));
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
        scope_id: user?.id,
        target: first.target,
      })
      .catch(() => {
        console.warn('[NotificationInbox] native notification failed', {
          notification_id: first.id,
          notification_version: first.version,
          target_type: first.target.type,
        });
      });
  }, [data, t, user?.id]);
};
