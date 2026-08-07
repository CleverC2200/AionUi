/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';

import { getConversationSortOrder } from './sortOrderHelpers';

export type SidebarLayoutMode = 'projects' | 'list';
export type SidebarSortMode = 'priority' | 'recent' | 'manual';

export const sortSidebarConversations = (
  conversations: TChatConversation[],
  mode: SidebarSortMode,
  needsAttention: (conversation: TChatConversation) => boolean
): TChatConversation[] => {
  return conversations.toSorted((a, b) => {
    if (mode === 'priority') {
      const priorityDifference = Number(needsAttention(b)) - Number(needsAttention(a));
      if (priorityDifference !== 0) return priorityDifference;
    }

    if (mode === 'manual') {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined && orderA !== orderB) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
    }

    return getActivityTime(b) - getActivityTime(a);
  });
};

export const conversationNeedsAttention = (
  conversation: TChatConversation,
  hasCompletionUnread: (conversationId: string) => boolean
): boolean => {
  return (
    hasCompletionUnread(conversation.id) ||
    conversation.runtime?.state === 'waiting_confirmation' ||
    (conversation.runtime?.pending_confirmations ?? 0) > 0
  );
};
