/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import {
  buildGroupedHistory,
  getProjectConversations,
} from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';

const t = (key: string): string => key;

const conversation = (id: string, extra: TChatConversation['extra'], modified_at: number): TChatConversation =>
  ({
    id,
    name: id,
    type: 'acp',
    created_at: modified_at,
    modified_at,
    extra,
  }) as TChatConversation;

describe('buildGroupedHistory', () => {
  it('keeps scheduled-task conversations in the regular conversation timeline', () => {
    const result = buildGroupedHistory(
      [conversation('cron-conversation', { backend: 'aioncore', cron_job_id: 'job-1' }, 100)],
      t
    );

    expect(result.timelineSections[0]?.items).toEqual([
      expect.objectContaining({
        type: 'conversation',
        conversation: expect.objectContaining({ id: 'cron-conversation' }),
      }),
    ]);
  });

  it('keeps scheduled-task conversations with workspaces in the project section', () => {
    const result = buildGroupedHistory(
      [
        conversation(
          'cron-project-conversation',
          {
            backend: 'aioncore',
            cron_job_id: 'job-1',
            workspace: '/repo/aionui',
            custom_workspace: true,
          },
          100
        ),
      ],
      t
    );

    expect(result.timelineSections[0]?.items).toEqual([
      expect.objectContaining({
        type: 'workspace',
        workspaceGroup: expect.objectContaining({
          workspace: '/repo/aionui',
          conversations: [expect.objectContaining({ id: 'cron-project-conversation' })],
        }),
      }),
    ]);
  });

  it('continues to hide team-owned conversations from the regular history', () => {
    const result = buildGroupedHistory(
      [conversation('team-conversation', { backend: 'aioncore', team_id: 'team-1' }, 100)],
      t
    );

    expect(result.timelineSections).toEqual([]);
  });
});

describe('getProjectConversations', () => {
  it('includes pinned conversations from the same workspace and excludes unrelated or team-owned conversations', () => {
    const workspace = '/repo/aionui';
    const regular = conversation('regular', { backend: 'aioncore', workspace, custom_workspace: true }, 100);
    const pinned = conversation('pinned', { backend: 'aioncore', workspace, custom_workspace: true, pinned: true }, 90);
    const otherProject = conversation(
      'other-project',
      { backend: 'aioncore', workspace: '/repo/other', custom_workspace: true },
      80
    );
    const temporaryWorkspace = conversation(
      'temporary',
      { backend: 'aioncore', workspace, custom_workspace: false },
      70
    );
    const teamOwned = conversation(
      'team-owned',
      { backend: 'aioncore', workspace, custom_workspace: true, team_id: 'team-1' },
      60
    );

    expect(
      getProjectConversations([regular, pinned, otherProject, temporaryWorkspace, teamOwned], workspace).map(
        (item) => item.id
      )
    ).toEqual(['regular', 'pinned']);
  });
});
