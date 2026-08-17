import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSWRMock = vi.fn();
const usePresetAssistantInfoMock = vi.fn();
const getConversationOrNullMock = vi.fn();
const acpDraftMutateMock = vi.fn();
const aionrsDraftMutateMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: (...args: unknown[]) => useSWRMock(...args),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: (...args: unknown[]) => usePresetAssistantInfoMock(...args),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: (...args: unknown[]) => getConversationOrNullMock(...args),
}));

vi.mock('@renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: (kind: 'acp' | 'aionrs') => () => ({
    mutate: kind === 'aionrs' ? aionrsDraftMutateMock : acpDraftMutateMock,
  }),
}));

vi.mock('@renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
  resolveAgentLogo: () => null,
  resolveAgentAvatar: () => ({ kind: 'fallback' }),
}));

vi.mock('@renderer/utils/platform', () => ({
  resolveBackendAssetUrl: (value: string | undefined) => value,
}));

import TeamChatEmptyState from '@/renderer/pages/team/components/TeamChatEmptyState';

describe('TeamChatEmptyState', () => {
  beforeEach(() => {
    useSWRMock.mockReset();
    usePresetAssistantInfoMock.mockReset();
    getConversationOrNullMock.mockReset();
    acpDraftMutateMock.mockReset();
    aionrsDraftMutateMock.mockReset();
  });

  it('prefers assistant props over legacy runtime extra metadata when preset info is unavailable', () => {
    useSWRMock.mockReturnValue({
      data: {
        id: 'conv-1',
        type: 'acp',
        name: 'Team - Legacy Worker',
        extra: {
          team_id: 'team-1',
          agent_name: 'Legacy Runtime Name',
          backend: 'claude',
        },
      },
    });
    usePresetAssistantInfoMock.mockReturnValue({ info: null });

    render(
      <TeamChatEmptyState conversation_id='conv-1' assistant_name='Assistant Runtime Name' assistant_backend='aionrs' />
    );

    expect(screen.getByText('Assistant Runtime Name')).toBeInTheDocument();
    expect(screen.queryByText('Legacy Runtime Name')).not.toBeInTheDocument();
  });

  it('falls back to legacy runtime metadata when assistant props are absent', () => {
    useSWRMock.mockReturnValue({
      data: {
        id: 'conv-1',
        type: 'acp',
        name: 'Team - Legacy Worker',
        extra: {
          team_id: 'team-1',
          agent_name: 'Legacy Runtime Name',
          backend: 'claude',
        },
      },
    });
    usePresetAssistantInfoMock.mockReturnValue({ info: null });

    render(<TeamChatEmptyState conversation_id='conv-1' />);

    expect(screen.getByText('Legacy Runtime Name')).toBeInTheDocument();
  });

  it('uses assistant-first fallback suggestion copy', () => {
    useSWRMock.mockReturnValue({
      data: {
        id: 'conv-1',
        type: 'acp',
        name: 'Team - Leader',
        extra: {
          team_id: 'team-1',
          backend: 'claude',
        },
      },
    });
    usePresetAssistantInfoMock.mockReturnValue({ info: null });

    render(<TeamChatEmptyState conversation_id='conv-1' isLeader />);

    expect(screen.getByText('Organize a debate with assistants taking different sides')).toBeInTheDocument();
    // Middle suggestion is now the "ask the Leader to add a member" prompt.
    expect(screen.getByText('Help me add a member good at ___ to the team')).toBeInTheDocument();
  });

  it('prefers the leader assistant recommended prompts over generic team suggestions', () => {
    useSWRMock.mockReturnValue({
      data: {
        id: 'conv-1',
        type: 'acp',
        name: 'Team - Supply Chain Leader',
        extra: { team_id: 'team-1', backend: 'aionrs' },
      },
    });
    usePresetAssistantInfoMock.mockReturnValue({
      info: {
        name: 'Supply Chain Leader',
        logo: '🤖',
        isEmoji: true,
        backend: 'aionrs',
        recommendedPrompts: [
          'Review demand, safety stock, and dealer replenishment risks',
          'Prioritize shortages, excess stock, aging, and plan variance',
          'Coordinate a cross-domain review for a selected site or product',
        ],
      },
    });

    render(<TeamChatEmptyState conversation_id='conv-1' isLeader />);

    expect(screen.getByText('Review demand, safety stock, and dealer replenishment risks')).toBeInTheDocument();
    expect(screen.getByText('Prioritize shortages, excess stock, aging, and plan variance')).toBeInTheDocument();
    expect(screen.getByText('Coordinate a cross-domain review for a selected site or product')).toBeInTheDocument();
    expect(screen.queryByText('Organize a debate with assistants taking different sides')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Review demand, safety stock, and dealer replenishment risks'));
    expect(acpDraftMutateMock).toHaveBeenCalledOnce();
    const updateDraft = acpDraftMutateMock.mock.calls[0][0] as (draft: { content: string }) => { content: string };
    expect(updateDraft({ content: '' })).toEqual({
      content: 'Review demand, safety stock, and dealer replenishment risks',
    });
  });

  it('shows a member greeting for non-leader members', () => {
    useSWRMock.mockReturnValue({
      data: {
        id: 'conv-1',
        type: 'acp',
        name: 'Team - Worker',
        extra: { team_id: 'team-1', backend: 'claude' },
      },
    });
    usePresetAssistantInfoMock.mockReturnValue({ info: null });

    render(<TeamChatEmptyState conversation_id='conv-1' />);

    expect(screen.getByTestId('team-chat-empty-state-subtitle')).toHaveTextContent(
      "Hi, I'm a team member. I take direction from the Leader and you."
    );
  });
});
