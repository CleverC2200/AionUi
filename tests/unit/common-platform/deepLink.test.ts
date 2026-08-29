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
  ])('rejects an invalid or route-bearing response', (response) => {
    expect(() => parseDeepLinkResolveResponse(response)).toThrow(/^DEEP_LINK_RESOLVE_INVALID:/);
  });
});
