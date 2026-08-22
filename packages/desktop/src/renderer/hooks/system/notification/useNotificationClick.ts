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

/**
 * Hook to listen for notification click events from main process.
 * Navigates to the corresponding conversation page when a notification is clicked.
 */
export const useNotificationClick = () => {
  const navigate = useNavigate();

  const handler = useCallback(
    (payload: { conversation_id?: string; target?: NotificationTarget }) => {
      if (payload.target) {
        const destination = resolveNotificationNavigation(payload.target);
        if (destination) {
          void navigate(destination.pathname, { state: destination.state });
        }
        return;
      }
      if (payload.conversation_id) {
        void navigate(`/conversation/${payload.conversation_id}`);
      }
    },
    [navigate]
  );

  useEffect(() => {
    return ipcBridge.notification.clicked.on(handler);
  }, [handler]);
};
