import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamConversationResources, {
  selectTeamConversationRecords,
} from '@/renderer/pages/team/components/TeamConversationResources';
import type { ConversationRecord } from '@/common/types/conversationRecord';

const { recordsGet, recordsChangedOn, reconnectedOn } = vi.hoisted(() => ({
  recordsGet: vi.fn(),
  recordsChangedOn: vi.fn(() => vi.fn()),
  reconnectedOn: vi.fn(() => vi.fn()),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversationRecords: {
      get: { invoke: recordsGet },
      changed: { on: recordsChangedOn },
    },
    realtime: { reconnected: { on: reconnectedOn } },
  },
}));

vi.mock('@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview', () => ({
  useLocalFilePreview: () => vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ openBrowserTab: vi.fn() }),
}));

vi.mock('@/renderer/pages/conversation/components/ConversationResources', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/renderer/pages/conversation/components/ConversationResources')>();
  return {
    ...actual,
    ConversationResourcesButton: ({
      sources,
      scopeControls,
    }: {
      sources: unknown[];
      scopeControls?: React.ReactNode;
    }) => (
      <div data-testid='team-resources-projection'>
        <output data-testid='team-resources-source-count'>{sources.length}</output>
        {scopeControls}
      </div>
    ),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => `${key}${options?.name ? `:${options.name}` : ''}`,
  }),
}));

const record = (id: string, conversationId: string): ConversationRecord => ({
  id,
  revision: 1,
  record_type: 'context_evidence',
  conversation_id: conversationId,
  producer: { type: 'team_agent', id: `${conversationId}-agent` },
  created_at: '2026-08-12T00:00:00.000Z',
  resource: { kind: 'url', uri: `https://example.test/${id}`, name: id },
});

const members = [
  { slot_id: 'slot-a', conversation_id: 'conversation-a', assistant_name: 'Researcher' },
  { slot_id: 'slot-b', conversation_id: 'conversation-b', assistant_name: 'Writer' },
];

describe('TeamConversationResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordsGet.mockImplementation(({ conversation_id }: { conversation_id: string }) =>
      Promise.resolve({ revision: 1, records: [record(`evidence-${conversation_id}`, conversation_id)] })
    );
  });

  it('preserves original member records when switching between member and team scopes', () => {
    const first = record('evidence-a', 'conversation-a');
    const second = record('evidence-b', 'conversation-b');
    const byConversation = { 'conversation-a': [first], 'conversation-b': [second] };

    expect(selectTeamConversationRecords(byConversation, members, 'slot-a')).toEqual([first]);
    const all = selectTeamConversationRecords(byConversation, members, null);
    expect(all).toEqual([first, second]);
    expect(all[0]).toBe(first);
    expect(all[1]).toBe(second);
  });

  it('defaults to the active member and restores the aggregated team scope', async () => {
    render(
      <>
        <div id='conversation-resources-conversation-a' />
        <TeamConversationResources members={members} activeSlotId='slot-a' activeConversationId='conversation-a' />
      </>
    );

    await waitFor(() => expect(screen.getByTestId('team-resources-source-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('team-resource-active-filter')).toHaveTextContent('Researcher');

    fireEvent.click(screen.getByTestId('team-resource-filter-all'));
    await waitFor(() => expect(screen.getByTestId('team-resources-source-count')).toHaveTextContent('2'));
    expect(screen.queryByTestId('team-resource-active-filter')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('team-resource-filter-slot-b'));
    expect(screen.getByTestId('team-resource-active-filter')).toHaveTextContent('Writer');
    await waitFor(() => expect(screen.getByTestId('team-resources-source-count')).toHaveTextContent('1'));
  });
});
