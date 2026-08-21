import { ipcBridge } from '@/common';
import type { InteractionRequest } from '@/common/types/interactionRequest';
import {
  fetchActiveInteractionRequests,
  INTERACTION_REQUESTS_ACTIVE_KEY,
} from '@/renderer/services/interactionRequestActions';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

const requestVersionKey = (request: InteractionRequest): string => `${request.id}\0${request.version}`;
const isActionable = (request: InteractionRequest): boolean =>
  request.status === 'pending' || request.status === 'verification_required';

/**
 * Keeps the authoritative Interaction Request snapshot fresh independently of
 * sidebar visibility. The first snapshot establishes a notification baseline;
 * later actionable versions may notify the desktop user once per app session.
 */
export const useInteractionRequestSync = (): void => {
  const { t } = useTranslation();
  const knownVersionsRef = useRef<Set<string> | null>(null);
  const { data, mutate } = useSWR(INTERACTION_REQUESTS_ACTIVE_KEY, fetchActiveInteractionRequests);

  useEffect(() => {
    const refresh = (): void => {
      void mutate();
    };
    const offChanged = ipcBridge.interactionRequest.changed.on(refresh);
    const offReconnected = ipcBridge.realtime.reconnected.on(refresh);
    return () => {
      offChanged();
      offReconnected();
    };
  }, [mutate]);

  useEffect(() => {
    if (!data) return;

    const knownVersions = knownVersionsRef.current;
    if (!knownVersions) {
      knownVersionsRef.current = new Set(data.items.map(requestVersionKey));
      return;
    }

    const newlyActionable =
      data.sync_state === 'complete'
        ? data.items.filter((request) => isActionable(request) && !knownVersions.has(requestVersionKey(request)))
        : [];
    for (const request of data.items) {
      knownVersions.add(requestVersionKey(request));
    }

    if (newlyActionable.length === 0 || !isElectronDesktop()) return;
    void ipcBridge.notification.show.invoke({
      title: 'GEAUi',
      body: t('conversation.attention.notification', { count: newlyActionable.length }),
      conversation_id: newlyActionable[0].conversation_id,
    });
  }, [data, t]);
};
