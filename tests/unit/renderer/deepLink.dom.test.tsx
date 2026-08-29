import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeepLinkPayload, OpenConversationDeepLinkPayload } from '@/common/types/platform/deepLink';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  received: undefined as ((payload: DeepLinkPayload) => void) | undefined,
  unsubscribe: vi.fn(),
  claimPending: vi.fn<() => Promise<OpenConversationDeepLinkPayload | null>>(),
  resolve: vi.fn(),
  acknowledge: vi.fn(),
  reportFailure: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('@/common', () => ({
  ipcBridge: {
    deepLink: {
      received: {
        on: (callback: NonNullable<typeof state.received>) => {
          state.received = callback;
          return state.unsubscribe;
        },
      },
      claimPending: { invoke: state.claimPending },
      resolve: { invoke: state.resolve },
      acknowledge: { invoke: state.acknowledge },
      reportFailure: { invoke: state.reportFailure },
    },
  },
}));

import {
  acknowledgeResolvedConversationDeepLink,
  acknowledgeResolvedMessageDeepLink,
  acknowledgeResolvedTeamDeepLink,
  useDeepLink,
} from '@/renderer/hooks/system/useDeepLink';
import { notifyAuthSessionChanged, resetAuthSessionEpochForTests } from '@/renderer/hooks/context/AuthContext';

const payload: OpenConversationDeepLinkPayload = {
  action: 'open-conversation',
  params: { ref: 'nav_0123456789abcdef', v: '1', profile: 'gea.test' },
};

const emitClaimable = async (value: OpenConversationDeepLinkPayload): Promise<void> => {
  await waitFor(() => expect(state.claimPending).toHaveBeenCalled());
  state.claimPending.mockResolvedValueOnce(value);
  act(() => state.received?.(value));
};

describe('useDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthSessionEpochForTests();
    state.received = undefined;
    state.claimPending.mockResolvedValue(null);
    state.resolve.mockResolvedValue({
      schema_version: 1,
      target: { type: 'conversation', conversation_id: 'conversation/1', assistant_id: 'assistant-1' },
    });
    state.acknowledge.mockResolvedValue(true);
    state.reportFailure.mockResolvedValue(true);
  });

  it('resolves a hot open-conversation event through AionCore and navigates to the typed target', async () => {
    renderHook(() => useDeepLink());
    await emitClaimable(payload);

    await waitFor(() => {
      expect(state.resolve).toHaveBeenCalledWith({
        navigation_reference: payload.params.ref,
        schema_version: 1,
      });
      expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation%2F1');
    });
    expect(state.acknowledge).not.toHaveBeenCalled();

    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant-1' } })
    ).resolves.toBe(true);
    expect(state.acknowledge).toHaveBeenCalledWith({ navigation_reference: payload.params.ref });
  });

  it('ignores a hot event that Main no longer exposes as claimable', async () => {
    renderHook(() => useDeepLink());
    await waitFor(() => expect(state.claimPending).toHaveBeenCalled());
    act(() => state.received?.(payload));

    await waitFor(() => expect(state.claimPending).toHaveBeenCalled());
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('claims a cold-start intent after the authenticated layout mounts', async () => {
    state.claimPending.mockResolvedValue(payload);
    renderHook(() => useDeepLink());

    await waitFor(() => {
      expect(state.resolve).toHaveBeenCalledOnce();
      expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation%2F1');
    });
  });

  it('keeps the legacy navigate action compatible', async () => {
    renderHook(() => useDeepLink());
    act(() => state.received?.({ action: 'navigate', params: { route: '/conversation/legacy' } }));

    expect(state.navigate).toHaveBeenCalledWith('/conversation/legacy');
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it('rejects a malformed open-conversation payload at the renderer boundary', () => {
    renderHook(() => useDeepLink());
    act(() => state.received?.({ action: 'open-conversation', params: { ref: 'short', v: '1' } }));

    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('does not acknowledge an unresolved target', async () => {
    state.resolve.mockRejectedValue(new Error('DEEP_LINK_RESOLVE_FAILED'));
    renderHook(() => useDeepLink());
    await emitClaimable(payload);

    await waitFor(() => expect(state.resolve).toHaveBeenCalledOnce());
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.acknowledge).not.toHaveBeenCalled();
    expect(state.reportFailure).toHaveBeenCalledWith({
      navigation_reference: payload.params.ref,
      result_code: 'DEEP_LINK_RESOLVE_FAILED',
    });
  });

  it('preserves the backend stable error code in the failure report', async () => {
    state.resolve.mockRejectedValue({
      name: 'BackendHttpError',
      status: 403,
      code: 'NAVIGATION_REFERENCE_FORBIDDEN',
    });
    renderHook(() => useDeepLink());
    await emitClaimable(payload);

    await waitFor(() =>
      expect(state.reportFailure).toHaveBeenCalledWith({
        navigation_reference: payload.params.ref,
        result_code: 'NAVIGATION_REFERENCE_FORBIDDEN',
      })
    );
  });

  it('does not navigate with a resolver response from an older authenticated session', async () => {
    let completeResolve: ((value: unknown) => void) | undefined;
    state.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeResolve = resolve;
        })
    );
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.resolve).toHaveBeenCalledOnce());

    act(() => notifyAuthSessionChanged());
    await waitFor(() =>
      expect(state.reportFailure).toHaveBeenCalledWith({
        navigation_reference: payload.params.ref,
        result_code: 'DEEP_LINK_AUTH_SESSION_CHANGED',
      })
    );
    act(() =>
      completeResolve?.({
        schema_version: 1,
        target: { type: 'conversation', conversation_id: 'conversation/1', assistant_id: 'assistant-1' },
      })
    );

    await waitFor(() => expect(state.navigate).not.toHaveBeenCalled());
  });

  it('releases an already resolved target when the authenticated session changes before acknowledgement', async () => {
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    act(() => notifyAuthSessionChanged());

    await waitFor(() =>
      expect(state.reportFailure).toHaveBeenCalledWith({
        navigation_reference: payload.params.ref,
        result_code: 'DEEP_LINK_AUTH_SESSION_CHANGED',
      })
    );
    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant-1' } })
    ).resolves.toBe(false);
  });

  it.each([
    [
      { type: 'message', conversation_id: 'conversation/1', assistant_id: 'assistant-1', message_id: 'message-1' },
      '/conversation/conversation%2F1',
      { targetMessageId: 'message-1' },
    ],
    [{ type: 'team', team_id: 'team/1' }, '/team/team%2F1', undefined],
    [
      {
        type: 'slot',
        team_id: 'team/1',
        slot_id: 'slot-1',
        conversation_id: 'conversation/1',
        assistant_id: 'assistant-1',
      },
      '/team/team%2F1',
      { targetSlotId: 'slot-1' },
    ],
    [
      {
        type: 'interaction_request',
        conversation_id: 'conversation/1',
        assistant_id: 'assistant-1',
        interaction_request_id: 'request-1',
        message_id: 'message-1',
      },
      '/conversation/conversation%2F1',
      { interactionRequestId: 'request-1', targetMessageId: 'message-1' },
    ],
  ] as const)('navigates to a typed %s target', async (target, pathname, navigationState) => {
    state.resolve.mockResolvedValue({ schema_version: 1, target });
    renderHook(() => useDeepLink());
    await emitClaimable(payload);

    await waitFor(() => {
      if (navigationState) {
        expect(state.navigate).toHaveBeenCalledWith(pathname, { state: navigationState });
      } else {
        expect(state.navigate).toHaveBeenCalledWith(pathname);
      }
    });
  });

  it('acknowledges a Message target only after the exact message is reached', async () => {
    state.resolve.mockResolvedValue({
      schema_version: 1,
      target: {
        type: 'message',
        conversation_id: 'conversation/1',
        assistant_id: 'assistant-1',
        message_id: 'message-1',
      },
    });
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(
      acknowledgeResolvedMessageDeepLink({
        assistantId: 'assistant-1',
        conversationId: 'conversation/1',
        messageId: 'message-other',
      })
    ).resolves.toBe(false);
    await expect(
      acknowledgeResolvedMessageDeepLink({
        assistantId: 'assistant-other',
        conversationId: 'conversation/1',
        messageId: 'message-1',
      })
    ).resolves.toBe(false);
    await expect(
      acknowledgeResolvedMessageDeepLink({
        assistantId: 'assistant-1',
        conversationId: 'conversation/1',
        messageId: 'message-1',
      })
    ).resolves.toBe(true);
  });

  it('acknowledges a Slot target only after the exact local slot identity is reached', async () => {
    state.resolve.mockResolvedValue({
      schema_version: 1,
      target: {
        type: 'slot',
        team_id: 'team-1',
        slot_id: 'slot-1',
        conversation_id: 'conversation-1',
        assistant_id: 'assistant-1',
      },
    });
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(
      acknowledgeResolvedTeamDeepLink(
        'team-1',
        [{ slot_id: 'slot-1', conversation_id: 'conversation-1', assistant_id: 'assistant-other' }],
        'slot-1'
      )
    ).resolves.toBe(false);
    await expect(
      acknowledgeResolvedTeamDeepLink(
        'team-1',
        [{ slot_id: 'slot-1', conversation_id: 'conversation-1', assistant_id: 'assistant-1' }],
        'slot-other'
      )
    ).resolves.toBe(false);
    await expect(
      acknowledgeResolvedTeamDeepLink(
        'team-1',
        [{ slot_id: 'slot-1', conversation_id: 'conversation-1', assistant_id: 'assistant-1' }],
        'slot-1'
      )
    ).resolves.toBe(true);
  });

  it('fails closed when the loaded Conversation belongs to another Assistant', async () => {
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant-other' } })
    ).resolves.toBe(false);
    expect(state.acknowledge).not.toHaveBeenCalled();
    expect(state.reportFailure).toHaveBeenCalledWith({
      navigation_reference: payload.params.ref,
      result_code: 'DEEP_LINK_ASSISTANT_MISMATCH',
    });
  });

  it('fails closed when the native acknowledge bridge is unavailable', async () => {
    state.acknowledge.mockRejectedValueOnce(new Error('bridge unavailable'));
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant/1' } })
    ).resolves.toBe(false);
  });

  it('clears an Assistant mismatch when the native failure bridge is unavailable', async () => {
    state.reportFailure.mockRejectedValueOnce(new Error('bridge unavailable'));
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant-other' } })
    ).resolves.toBe(false);
    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant/1' } })
    ).resolves.toBe(false);
    expect(state.acknowledge).not.toHaveBeenCalled();
  });
});
