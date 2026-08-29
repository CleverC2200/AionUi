/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import {
  OPEN_CONVERSATION_SCHEMA_VERSION,
  isOpenConversationDeepLinkPayload,
  type DeepLinkPayload,
  type DeepLinkTarget,
  type OpenConversationDeepLinkPayload,
} from '@/common/types/platform/deepLink';
import { getAuthSessionEpochSnapshot, useAuthSessionEpoch } from '@/renderer/hooks/context/AuthContext';

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

type PendingResolvedTarget = {
  authSessionEpoch: number;
  navigationReference: string;
  target: DeepLinkTarget;
};

let pendingResolvedTarget: PendingResolvedTarget | null = null;

type DeepLinkNavigation = {
  pathname: string;
  state?: Record<string, string>;
};

const pathSegment = (value: string): string => encodeURIComponent(value);

export const resolveDeepLinkNavigation = (target: DeepLinkTarget): DeepLinkNavigation => {
  switch (target.type) {
    case 'conversation':
      return { pathname: `/conversation/${pathSegment(target.conversation_id)}` };
    case 'message':
      return {
        pathname: `/conversation/${pathSegment(target.conversation_id)}`,
        state: { targetMessageId: target.message_id },
      };
    case 'interaction_request':
      return target.team_id && target.slot_id
        ? {
            pathname: `/team/${pathSegment(target.team_id)}`,
            state: {
              targetSlotId: target.slot_id,
              interactionRequestId: target.interaction_request_id,
              ...(target.message_id ? { targetMessageId: target.message_id } : {}),
            },
          }
        : {
            pathname: `/conversation/${pathSegment(target.conversation_id)}`,
            state: {
              interactionRequestId: target.interaction_request_id,
              ...(target.message_id ? { targetMessageId: target.message_id } : {}),
            },
          };
    case 'team':
      return { pathname: `/team/${pathSegment(target.team_id)}` };
    case 'slot':
      return {
        pathname: `/team/${pathSegment(target.team_id)}`,
        state: { targetSlotId: target.slot_id },
      };
  }
};

const acknowledgePendingTarget = async (pending: PendingResolvedTarget): Promise<boolean> => {
  if (getAuthSessionEpochSnapshot() !== pending.authSessionEpoch) return false;
  try {
    const acknowledged = await ipcBridge.deepLink.acknowledge.invoke({
      navigation_reference: pending.navigationReference,
    });
    if (acknowledged && pendingResolvedTarget === pending) pendingResolvedTarget = null;
    return acknowledged;
  } catch {
    // WebUI and older desktop builds do not expose native deep-link acknowledgement.
    return false;
  }
};

export const acknowledgeResolvedConversationDeepLink = async (conversation: {
  assistant?: { id: string };
  id: string;
}): Promise<boolean> => {
  const pending = pendingResolvedTarget;
  if (!pending || !('conversation_id' in pending.target) || pending.target.conversation_id !== conversation.id) {
    return false;
  }
  if (conversation.assistant?.id !== pending.target.assistant_id) {
    try {
      await ipcBridge.deepLink.reportFailure.invoke({
        navigation_reference: pending.navigationReference,
        result_code: 'DEEP_LINK_ASSISTANT_MISMATCH',
      });
    } catch {
      // WebUI and older desktop builds do not expose sanitized deep-link result reporting.
    } finally {
      if (pendingResolvedTarget === pending) pendingResolvedTarget = null;
    }
    return false;
  }

  return pending.target.type === 'conversation' ? acknowledgePendingTarget(pending) : false;
};

export const acknowledgeResolvedMessageDeepLink = async (target: {
  assistantId?: string;
  conversationId: string;
  interactionRequestId?: string;
  messageId: string;
}): Promise<boolean> => {
  const pending = pendingResolvedTarget;
  if (
    !pending ||
    !('conversation_id' in pending.target) ||
    pending.target.conversation_id !== target.conversationId ||
    pending.target.assistant_id !== target.assistantId
  ) {
    return false;
  }
  if (pending.target.type === 'message' && pending.target.message_id === target.messageId) {
    return acknowledgePendingTarget(pending);
  }
  if (
    pending.target.type === 'interaction_request' &&
    pending.target.interaction_request_id === target.interactionRequestId &&
    (!pending.target.message_id || pending.target.message_id === target.messageId)
  ) {
    return acknowledgePendingTarget(pending);
  }
  return false;
};

export const acknowledgeResolvedTeamDeepLink = async (
  teamId: string,
  assistants: Array<{ assistant_id?: string; conversation_id: string; slot_id: string }>,
  activeSlotId?: string
): Promise<boolean> => {
  const pending = pendingResolvedTarget;
  if (!pending) return false;
  if (pending.target.type === 'team' && pending.target.team_id === teamId) {
    return acknowledgePendingTarget(pending);
  }
  if (pending.target.type !== 'slot' || pending.target.team_id !== teamId) return false;
  const target = pending.target;
  if (activeSlotId !== target.slot_id) return false;
  const assistant = assistants.find((item) => item.slot_id === target.slot_id);
  if (
    !assistant ||
    assistant.conversation_id !== target.conversation_id ||
    assistant.assistant_id !== target.assistant_id
  ) {
    return false;
  }
  return acknowledgePendingTarget(pending);
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
  const authSessionEpoch = useAuthSessionEpoch();
  const resolvingReference = useRef<{ authSessionEpoch: number; navigationReference: string } | null>(null);

  const openResolvedConversation = useCallback(
    async (payload: OpenConversationDeepLinkPayload) => {
      const navigationReference = payload.params.ref;
      if (
        resolvingReference.current?.navigationReference === navigationReference &&
        resolvingReference.current.authSessionEpoch === authSessionEpoch
      ) {
        return;
      }
      resolvingReference.current = { authSessionEpoch, navigationReference };

      try {
        const resolved = await ipcBridge.deepLink.resolve.invoke({
          navigation_reference: navigationReference,
          schema_version: OPEN_CONVERSATION_SCHEMA_VERSION,
        });
        if (getAuthSessionEpochSnapshot() !== authSessionEpoch) return;
        pendingResolvedTarget = {
          authSessionEpoch,
          navigationReference,
          target: resolved.target,
        };
        const destination = resolveDeepLinkNavigation(resolved.target);
        if (destination.state) {
          void navigate(destination.pathname, { state: destination.state });
        } else {
          void navigate(destination.pathname);
        }
      } catch (error) {
        const result = isBackendHttpError(error)
          ? error.code
          : error instanceof Error
            ? error.message.match(/^([A-Z][A-Z0-9_]{2,80})(?::|$)/)?.[1]
            : undefined;
        try {
          await ipcBridge.deepLink.reportFailure.invoke({
            navigation_reference: navigationReference,
            result_code: result ?? 'DEEP_LINK_RESOLVE_FAILED',
          });
        } catch {
          // Older desktop builds do not expose sanitized deep-link result reporting.
        }
      } finally {
        if (
          resolvingReference.current?.navigationReference === navigationReference &&
          resolvingReference.current.authSessionEpoch === authSessionEpoch
        ) {
          resolvingReference.current = null;
        }
      }
    },
    [authSessionEpoch, navigate]
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
    const receive = (payload: DeepLinkPayload): void => {
      if (!isOpenConversationDeepLinkPayload(payload)) {
        handler(payload);
        return;
      }
      void ipcBridge.deepLink.claimPending
        .invoke()
        .then((claimed) => {
          if (claimed) handler(claimed);
        })
        .catch(() => {
          // WebUI and older desktop builds do not have a native pending queue.
        });
    };
    const unsubscribe = ipcBridge.deepLink.received.on(receive);
    const activate = async () => {
      const staleReferences = new Set<string>();
      if (pendingResolvedTarget && pendingResolvedTarget.authSessionEpoch !== authSessionEpoch) {
        staleReferences.add(pendingResolvedTarget.navigationReference);
        pendingResolvedTarget = null;
      }
      const resolving = resolvingReference.current;
      if (resolving && resolving.authSessionEpoch !== authSessionEpoch) {
        resolvingReference.current = null;
        staleReferences.add(resolving.navigationReference);
      }
      await Promise.all(
        [...staleReferences].map(async (navigationReference) => {
          try {
            await ipcBridge.deepLink.reportFailure.invoke({
              navigation_reference: navigationReference,
              result_code: 'DEEP_LINK_AUTH_SESSION_CHANGED',
            });
          } catch {
            // Older desktop builds do not expose sanitized deep-link result reporting.
          }
        })
      );
      try {
        const payload = await ipcBridge.deepLink.claimPending.invoke();
        if (payload) handler(payload);
      } catch {
        // WebUI and older desktop builds do not have a native pending queue.
      }
    };
    void activate();
    return unsubscribe;
  }, [authSessionEpoch, handler]);
};
