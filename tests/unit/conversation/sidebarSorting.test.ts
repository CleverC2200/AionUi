/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import {
  conversationNeedsAttention,
  sortSidebarConversations,
} from '@/renderer/pages/conversation/GroupedHistory/utils/sidebarSorting';
import { describe, expect, it } from 'vitest';

const conversation = (
  id: string,
  modifiedAt: number,
  extra: Partial<TChatConversation['extra']> = {},
  runtime?: TChatConversation['runtime']
): TChatConversation =>
  ({
    id,
    name: id,
    type: 'acp',
    created_at: modifiedAt,
    modified_at: modifiedAt,
    extra: { backend: 'aioncore', ...extra },
    runtime,
  }) as TChatConversation;

describe('sidebar conversation sorting', () => {
  it('shows attention-requiring conversations before newer regular conversations', () => {
    const olderUnread = conversation('older-unread', 10);
    const newerRead = conversation('newer-read', 20);

    const sorted = sortSidebarConversations([newerRead, olderUnread], 'priority', (item) => item.id === olderUnread.id);

    expect(sorted.map((item) => item.id)).toEqual(['older-unread', 'newer-read']);
  });

  it('uses recent activity as the fallback for priority and recent modes', () => {
    const older = conversation('older', 10);
    const newer = conversation('newer', 20);

    expect(sortSidebarConversations([older, newer], 'priority', () => false).map((item) => item.id)).toEqual([
      'newer',
      'older',
    ]);
    expect(sortSidebarConversations([older, newer], 'recent', () => false).map((item) => item.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('uses persisted sortOrder values in manual mode', () => {
    const first = conversation('first', 10, { sortOrder: 1000 } as Partial<TChatConversation['extra']>);
    const second = conversation('second', 20, { sortOrder: 2000 } as Partial<TChatConversation['extra']>);

    expect(sortSidebarConversations([second, first], 'manual', () => false).map((item) => item.id)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('conversationNeedsAttention', () => {
  it('includes unread completions and pending confirmations', () => {
    const unread = conversation('unread', 10);
    const pending = conversation(
      'pending',
      20,
      {},
      {
        state: 'waiting_confirmation',
        can_send_message: false,
        has_task: true,
        is_processing: false,
        pending_confirmations: 1,
        turn_id: 'turn-1',
      }
    );

    expect(conversationNeedsAttention(unread, (id) => id === unread.id)).toBe(true);
    expect(conversationNeedsAttention(pending, () => false)).toBe(true);
  });
});
