import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  getUserConversations: vi.fn(),
  responseStreamListener: undefined as ((message: Record<string, unknown>) => void) | undefined,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
    database: {
      getUserConversations: { invoke: fixtures.getUserConversations },
    },
    conversation: {
      listChanged: { on: vi.fn() },
      responseStream: {
        on: vi.fn((listener: (message: Record<string, unknown>) => void) => {
          fixtures.responseStreamListener = listener;
        }),
      },
      turnCompleted: { on: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: vi.fn() }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe('useConversationListSync refresh scheduling', () => {
  beforeEach(() => {
    fixtures.getUserConversations.mockReset();
    fixtures.responseStreamListener = undefined;
  });

  it('coalesces unknown-conversation events and applies the catch-up refresh last', async () => {
    const initial = deferred<{ items: Array<{ id: string; project_id: string | null }> }>();
    const catchUp = deferred<{ items: Array<{ id: string; project_id: string | null }> }>();
    fixtures.getUserConversations.mockReturnValue(catchUp.promise).mockReturnValueOnce(initial.promise);

    const { useConversationListSync } =
      await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
    const { result } = renderHook(() => useConversationListSync());

    await waitFor(() => expect(fixtures.responseStreamListener).toBeTypeOf('function'));

    act(() => {
      fixtures.responseStreamListener?.({ conversation_id: 'new-conversation', type: 'content', data: {} });
      fixtures.responseStreamListener?.({ conversation_id: 'new-conversation', type: 'thought', data: {} });
      fixtures.responseStreamListener?.({ conversation_id: 'new-conversation', type: 'tool_group', data: {} });
    });

    expect(fixtures.getUserConversations).toHaveBeenCalledTimes(1);

    await act(async () => {
      initial.resolve({ items: [{ id: 'old-conversation', project_id: null }] });
      await initial.promise;
    });

    await waitFor(() => expect(fixtures.getUserConversations).toHaveBeenCalledTimes(2));

    await act(async () => {
      catchUp.resolve({ items: [{ id: 'new-conversation', project_id: 'project-1' }] });
      await catchUp.promise;
    });

    await waitFor(() =>
      expect(result.current.conversations.map((conversation) => conversation.id)).toEqual(['new-conversation'])
    );
    expect(fixtures.getUserConversations).toHaveBeenCalledTimes(2);
  });
});
