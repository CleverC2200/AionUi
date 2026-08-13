/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { SidebarGroup, SidebarItem, SidebarResponse } from '@/common/types/sidebar';
import { isBackendRouteUnavailableError } from './httpBridge';

const getActivityTime = (conversation: TChatConversation): number =>
  conversation.modified_at || conversation.created_at || 0;

const isHiddenConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { is_health_check?: boolean; team_id?: string; teamId?: string } | undefined;
  return extra?.is_health_check === true || Boolean(extra?.team_id || extra?.teamId);
};

const getWorkspaceName = (workspace: string): string => {
  const parts = workspace.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || workspace;
};

/** A 404 is a capability signal only when the backend says the route itself is absent. */
export const isRouteUnavailableError = (error: unknown): boolean => isBackendRouteUnavailableError(error);

/**
 * Rebuild the pre-read-model sidebar from the routes shipped by older AionCore
 * versions. This is deliberately a compatibility projection: once
 * `GET /api/sidebar` exists, its grouping and ordering remain authoritative.
 */
export const buildLegacySidebarResponse = ({
  conversations,
}: {
  conversations: TChatConversation[];
}): SidebarResponse => {
  const visible = conversations.filter((conversation) => !isHiddenConversation(conversation));
  const pinned = visible
    .filter((conversation) => Boolean(conversation.extra?.pinned))
    .toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
  const normal = visible.filter((conversation) => !conversation.extra?.pinned);
  const projectConversations = new Map<string, TChatConversation[]>();
  const chats: TChatConversation[] = [];

  for (const conversation of normal) {
    const workspace = conversation.extra?.workspace;
    if (conversation.extra?.custom_workspace && workspace) {
      const items = projectConversations.get(workspace) ?? [];
      items.push(conversation);
      projectConversations.set(workspace, items);
    } else {
      chats.push(conversation);
    }
  }

  const groups: SidebarGroup[] = [];
  if (pinned.length > 0) {
    groups.push({
      scope: { type: 'pinned' },
      items: pinned.map((conversation): SidebarItem => ({ type: 'conversation', conversation })),
      has_more: false,
    });
  }

  const projects = [...projectConversations.entries()]
    .map(([workspace, items]) => ({
      workspace,
      items: items.toSorted((a, b) => getActivityTime(b) - getActivityTime(a)),
    }))
    .toSorted((a, b) => getActivityTime(b.items[0]) - getActivityTime(a.items[0]));
  for (const project of projects) {
    groups.push({
      scope: {
        type: 'dir',
        key: project.workspace,
        path: project.workspace,
        name: getWorkspaceName(project.workspace),
      },
      items: project.items.map((conversation): SidebarItem => ({ type: 'conversation', conversation })),
      has_more: false,
    });
  }

  const sortedChats = chats.toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
  if (sortedChats.length > 0) {
    groups.push({
      scope: { type: 'chats' },
      items: sortedChats.map((conversation): SidebarItem => ({ type: 'conversation', conversation })),
      has_more: false,
    });
  }

  return { groups, has_more_groups: false };
};
