import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AttentionInbox } from '@/renderer/pages/conversation/attention/AttentionInbox';

const { listInvoke, changedOn } = vi.hoisted(() => ({
  listInvoke: vi.fn(),
  changedOn: vi.fn(() => vi.fn()),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    interactionRequest: {
      list: { invoke: listInvoke },
      changed: { on: changedOn },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      `${key}${options?.count === undefined ? '' : `:${options.count}`}`,
  }),
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid='location'>{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>
  );
};

describe('AttentionInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInvoke.mockResolvedValue({
      revision: 'attention-r1',
      items: [
        {
          id: 'request-1',
          version: 'v1',
          kind: 'permission',
          status: 'pending',
          title: 'Approve production submission',
          summary: 'Return to the original governed turn',
          source: { type: 'business_system', label: 'Finance' },
          conversation_id: 'conversation-1',
          turn_id: 'turn-1',
          message_id: 'message-1',
          allowed_actions: ['approve', 'reject'],
          updated_at: '2026-08-12T00:00:00.000Z',
        },
      ],
    });
  });

  it('projects pending work and returns to the authoritative conversation message', async () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter initialEntries={['/guid']}>
        <AttentionInbox onNavigate={onNavigate} />
        <LocationProbe />
      </MemoryRouter>
    );

    const trigger = await screen.findByTestId('attention-inbox-trigger');
    expect(trigger).toHaveAttribute('aria-label', 'conversation.attention.open:1');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('attention-request-request-1'));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location')).toHaveTextContent('"pathname":"/conversation/conversation-1"');
    expect(screen.getByTestId('location')).toHaveTextContent('"targetMessageId":"message-1"');
  });
});
