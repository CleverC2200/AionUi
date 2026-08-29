/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import {
  OPEN_CONVERSATION_SCHEMA_VERSION,
  isOpenConversationDeepLinkPayload,
  type DeepLinkPayload,
  type OpenConversationDeepLinkPayload,
} from '@/common/types/platform/deepLink';

/**
 * Deep link event payload from main process
 */
export type { DeepLinkPayload } from '@/common/types/platform/deepLink';

export type DeepLinkAddProviderDetail = {
  base_url?: string;
  api_key?: string;
  name?: string;
  platform?: string;
};

/** Pending deep link data for the add-provider action. Read-once: consumed by ModelModalContent on mount. */
let pendingDeepLinkData: DeepLinkAddProviderDetail | null = null;

type PendingResolvedConversation = {
  assistantId: string;
  conversationId: string;
  navigationReference: string;
};

let pendingResolvedConversation: PendingResolvedConversation | null = null;

export const acknowledgeResolvedConversationDeepLink = async (conversation: {
  assistant?: { id: string };
  id: string;
}): Promise<boolean> => {
  const pending = pendingResolvedConversation;
  if (!pending || pending.conversationId !== conversation.id) return false;
  if (conversation.assistant?.id !== pending.assistantId) {
    await ipcBridge.deepLink.reportFailure.invoke({
      navigation_reference: pending.navigationReference,
      result_code: 'DEEP_LINK_ASSISTANT_MISMATCH',
    });
    pendingResolvedConversation = null;
    return false;
  }

  const acknowledged = await ipcBridge.deepLink.acknowledge.invoke({
    navigation_reference: pending.navigationReference,
  });
  if (acknowledged) pendingResolvedConversation = null;
  return acknowledged;
};

/**
 * Consume (read and clear) pending deep link data.
 * Returns the data if present, or null. Subsequent calls return null until new data arrives.
 */
export const consumePendingDeepLink = (): DeepLinkAddProviderDetail | null => {
  const data = pendingDeepLinkData;
  pendingDeepLinkData = null;
  return data;
};

/**
 * Allowed route patterns for the navigate deep link action.
 * Only routes matching these patterns are permitted.
 */
const ALLOWED_NAVIGATE_PATTERNS = [/^\/team\/[^/]+$/, /^\/conversation\/[^/]+$/];

/**
 * Hook to listen for aionui:// deep link events from main process.
 * Routes 'add-provider' action to the model settings page.
 * Routes 'navigate' action to the specified route (whitelist-validated).
 * The pre-fill data is stored in a module-level variable and consumed
 * by ModelModalContent on mount via consumePendingDeepLink().
 */
export const useDeepLink = () => {
  const navigate = useNavigate();
  const resolvingReference = useRef<string | null>(null);

  const openResolvedConversation = useCallback(
    async (payload: OpenConversationDeepLinkPayload) => {
      const navigationReference = payload.params.ref;
      if (resolvingReference.current === navigationReference) return;
      resolvingReference.current = navigationReference;

      try {
        const resolved = await ipcBridge.deepLink.resolve.invoke({
          navigation_reference: navigationReference,
          schema_version: OPEN_CONVERSATION_SCHEMA_VERSION,
        });
        pendingResolvedConversation = {
          assistantId: resolved.target.assistant_id,
          conversationId: resolved.target.conversation_id,
          navigationReference,
        };
        void navigate(`/conversation/${encodeURIComponent(resolved.target.conversation_id)}`);
      } catch (error) {
        const result = error instanceof Error ? error.message.match(/^([A-Z][A-Z0-9_]{2,80})(?::|$)/)?.[1] : undefined;
        try {
          await ipcBridge.deepLink.reportFailure.invoke({
            navigation_reference: navigationReference,
            result_code: result ?? 'DEEP_LINK_RESOLVE_FAILED',
          });
        } catch {
          // Older desktop builds do not expose sanitized deep-link result reporting.
        }
      } finally {
        if (resolvingReference.current === navigationReference) {
          resolvingReference.current = null;
        }
      }
    },
    [navigate]
  );

  const handler = useCallback(
    (payload: DeepLinkPayload) => {
      if (isOpenConversationDeepLinkPayload(payload)) {
        void openResolvedConversation(payload);
        return;
      }

      // Support both formats: "add-provider" and "provider/add" (one-api style)
      if (payload.action === 'add-provider' || payload.action === 'provider/add') {
        pendingDeepLinkData = {
          base_url: payload.params.base_url,
          api_key: payload.params.api_key || payload.params.key,
          name: payload.params.name,
          platform: payload.params.platform,
        };

        // Navigate to model settings page; ModelModalContent will pick up the pending data
        void navigate('/settings/model');
        return;
      }

      if (payload.action === 'navigate') {
        const route = payload.params.route;
        if (!route) {
          console.warn('[DeepLink] navigate action missing route param');
          return;
        }

        const isAllowed = ALLOWED_NAVIGATE_PATTERNS.some((pattern) => pattern.test(route));
        if (!isAllowed) {
          console.warn(`[DeepLink] navigate blocked: route "${route}" not in whitelist`);
          return;
        }

        void navigate(route);
      }
    },
    [navigate, openResolvedConversation]
  );

  useEffect(() => {
    const unsubscribe = ipcBridge.deepLink.received.on(handler);
    void ipcBridge.deepLink.claimPending
      .invoke()
      .then((payload) => {
        if (payload) handler(payload);
      })
      .catch(() => {
        // WebUI and older desktop builds do not have a native pending queue.
      });
    return unsubscribe;
  }, [handler]);
};
