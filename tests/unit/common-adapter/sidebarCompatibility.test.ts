/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { buildLegacySidebarResponse, isRouteUnavailableError } from '@/common/adapter/sidebarCompatibility';
import { describe, expect, it } from 'vitest';

const conversation = (
  id: string,
  workspace?: string,
  extra: Partial<TChatConversation['extra']> = {}
): TChatConversation =>
  ({
    id,
    name: id,
    type: 'acp',
    created_at: 100,
    modified_at: 100,
    extra: {
      backend: 'aioncore',
      workspace,
      custom_workspace: Boolean(workspace),
      ...extra,
    },
  }) as TChatConversation;

describe('sidebarCompatibility', () => {
  it('rebuilds project and conversation groups while filtering team-owned rows', () => {
    const response = buildLegacySidebarResponse({
      conversations: [
        conversation('project-chat', '/work/acme'),
        conversation('team-member', '/work/acme', { team_id: 'team-acme' }),
        conversation('free-chat'),
      ],
    });

    const project = response.groups.find((group) => group.scope.type === 'dir' && group.scope.path === '/work/acme');
    expect(project?.items).toEqual([
      expect.objectContaining({ type: 'conversation', conversation: expect.objectContaining({ id: 'project-chat' }) }),
    ]);

    const chats = response.groups.find((group) => group.scope.type === 'chats');
    expect(chats?.items).toEqual([
      expect.objectContaining({ type: 'conversation', conversation: expect.objectContaining({ id: 'free-chat' }) }),
    ]);
    expect(JSON.stringify(response)).not.toContain('team-member');
  });

  it('recognises only an unavailable route as a compatibility fallback signal', () => {
    const unavailable = new BackendHttpError({
      method: 'GET',
      path: '/api/sidebar',
      status: 404,
      body: { code: 'NOT_FOUND', error: 'Route not found.' },
    });
    const missingEntity = new BackendHttpError({
      method: 'GET',
      path: '/api/sidebar',
      status: 404,
      body: { code: 'NOT_FOUND', error: 'Project not found.' },
    });

    expect(isRouteUnavailableError(unavailable)).toBe(true);
    expect(isRouteUnavailableError(missingEntity)).toBe(false);
    expect(isRouteUnavailableError(new Error('offline'))).toBe(false);
  });
});
