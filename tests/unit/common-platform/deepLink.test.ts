import { describe, expect, it } from 'vitest';
import { parseDeepLinkResolveResponse } from '@/common/types/platform/deepLink';

describe('deep-link resolver contract', () => {
  it('accepts the V1 local Conversation target with ACK metadata', () => {
    expect(
      parseDeepLinkResolveResponse({
        navigation_intent_id: 'intent-1',
        schema_version: 1,
        target: {
          type: 'conversation',
          conversation_id: 'conversation-1',
        },
        expires_at: '2099-09-01T12:00:00Z',
        trace_id: 'trace-1',
      })
    ).toEqual({
      navigation_intent_id: 'intent-1',
      schema_version: 1,
      target: {
        type: 'conversation',
        conversation_id: 'conversation-1',
      },
      expires_at: '2099-09-01T12:00:00Z',
      trace_id: 'trace-1',
    });
  });

  it.each([
    {
      schema_version: 1,
      target: { type: 'conversation', conversation_id: 'conversation-1' },
    },
    {
      navigation_intent_id: 'intent-1',
      schema_version: 1,
      target: {
        type: 'conversation',
        conversation_id: 'conversation-1',
        route: '/settings/model',
      },
      expires_at: '2099-09-01T12:00:00Z',
      trace_id: 'trace-1',
    },
    {
      navigation_intent_id: 'intent-1',
      schema_version: 2,
      target: { type: 'conversation', conversation_id: 'conversation-1' },
      expires_at: '2099-09-01T12:00:00Z',
      trace_id: 'trace-1',
    },
    {
      navigation_intent_id: 'intent-1',
      schema_version: 1,
      target: { type: 'message', conversation_id: 'conversation-1', assistant_id: 'assistant-1' },
      expires_at: '2099-09-01T12:00:00Z',
      trace_id: 'trace-1',
    },
  ])('rejects an invalid or route-bearing response', (response) => {
    expect(() => parseDeepLinkResolveResponse(response)).toThrow(/^DEEP_LINK_RESOLVE_INVALID:/);
  });
});
