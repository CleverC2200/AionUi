/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { NotificationTarget } from '@/common/types/notification';
import { resolveNotificationNavigation } from '@/renderer/services/notificationNavigation';
import { useAuth } from '@/renderer/hooks/context/AuthContext';

/**
 * Hook to listen for notification click events from main process.
 * Navigates to the corresponding conversation page when a notification is clicked.
 */
export const useNotificationClick = () => {
  const navigate = useNavigate();
  const { status, user } = useAuth();

  const handler = useCallback(
    (payload: {
      conversation_id?: string;
      notification_id?: string;
      notification_version?: string;
      scope_id?: string;
      target?: NotificationTarget;
    }) => {
      if (payload.notification_id && (status !== 'authenticated' || !user || payload.scope_id !== user.id)) {
        console.info('[NotificationInbox] native click ignored', {
          notification_id: payload.notification_id,
          notification_version: payload.notification_version ?? '',
          target_type: payload.target?.type ?? 'notification',
          reason: 'identity_changed',
        });
        return;
      }
      if (payload.target) {
        const destination = resolveNotificationNavigation(payload.target);
        if (destination) {
          console.info('[NotificationInbox] navigation resolved', {
            notification_id: payload.notification_id ?? '',
            target_type: payload.target.type,
            result: 'navigating',
          });
          void navigate(destination.pathname, { state: destination.state });
        } else {
          console.info('[NotificationInbox] navigation unavailable', {
            notification_id: payload.notification_id ?? '',
            target_type: payload.target.type,
            result: 'ignored',
          });
        }
        return;
      }
      if (payload.conversation_id) {
        void navigate(`/conversation/${payload.conversation_id}`);
      }
    },
    [navigate, status, user]
  );

  useEffect(() => {
    return ipcBridge.notification.clicked.on(handler);
  }, [handler]);
};
