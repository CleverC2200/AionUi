import { describe, expect, it } from 'vitest';
import { parseDeepLinkResolveResponse } from '@/common/types/platform/deepLink';

describe('deep-link resolver contract', () => {
  it('accepts a typed local Conversation target with Assistant identity', () => {
    expect(
      parseDeepLinkResolveResponse({
        schema_version: 1,
        target: {
          type: 'conversation',
          conversation_id: 'conversation-1',
          assistant_id: 'assistant-1',
        },
        trace_id: 'trace-1',
      })
    ).toEqual({
      schema_version: 1,
      target: {
        type: 'conversation',
        conversation_id: 'conversation-1',
        assistant_id: 'assistant-1',
      },
      trace_id: 'trace-1',
    });
  });

  it.each([
    {
      type: 'message',
      conversation_id: 'conversation-1',
      assistant_id: 'assistant-1',
      message_id: 'message-1',
    },
    {
      type: 'interaction_request',
      conversation_id: 'conversation-1',
      assistant_id: 'assistant-1',
      interaction_request_id: 'request-1',
      message_id: 'message-1',
    },
    { type: 'team', team_id: 'team-1' },
    {
      type: 'slot',
      team_id: 'team-1',
      slot_id: 'slot-1',
      conversation_id: 'conversation-1',
      assistant_id: 'assistant-1',
    },
  ])('accepts a closed typed Interaction Location target: $type', (target) => {
    expect(parseDeepLinkResolveResponse({ schema_version: 1, target })).toEqual({ schema_version: 1, target });
  });

  it.each([
    {
      schema_version: 1,
      target: { type: 'conversation', conversation_id: 'conversation-1' },
    },
    {
      schema_version: 1,
      target: {
        type: 'conversation',
        conversation_id: 'conversation-1',
        assistant_id: 'assistant-1',
        route: '/settings/model',
      },
    },
    {
      schema_version: 2,
      target: { type: 'conversation', conversation_id: 'conversation-1', assistant_id: 'assistant-1' },
    },
    {
      schema_version: 1,
      target: { type: 'message', conversation_id: 'conversation-1', assistant_id: 'assistant-1' },
    },
    {
      schema_version: 1,
      target: { type: 'slot', team_id: 'team-1', slot_id: 'slot-1' },
    },
    {
      schema_version: 1,
      target: {
        type: 'interaction_request',
        conversation_id: 'conversation-1',
        assistant_id: 'assistant-1',
        interaction_request_id: 'request-1',
      },
    },
    {
      schema_version: 1,
      target: {
        type: 'interaction_request',
        conversation_id: 'conversation-1',
        assistant_id: 'assistant-1',
        interaction_request_id: 'request-1',
        message_id: 'message-1',
        team_id: 'team-1',
      },
    },
  ])('rejects an invalid or route-bearing response', (response) => {
    expect(() => parseDeepLinkResolveResponse(response)).toThrow(/^DEEP_LINK_RESOLVE_INVALID:/);
  });
});
