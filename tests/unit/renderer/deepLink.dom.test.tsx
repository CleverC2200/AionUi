import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeepLinkPayload, OpenConversationDeepLinkPayload } from '@/common/types/platform/deepLink';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  received: undefined as ((payload: DeepLinkPayload) => void) | undefined,
  unsubscribe: vi.fn(),
  claimPending: vi.fn<() => Promise<OpenConversationDeepLinkPayload | null>>(),
  resolve: vi.fn(),
  acknowledgeTarget: vi.fn(),
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
      acknowledgeTarget: { invoke: state.acknowledgeTarget },
      acknowledge: { invoke: state.acknowledge },
      reportFailure: { invoke: state.reportFailure },
    },
  },
}));

import { acknowledgeResolvedConversationDeepLink, useDeepLink } from '@/renderer/hooks/system/useDeepLink';
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
      navigation_intent_id: 'intent-1',
      schema_version: 1,
      target: { type: 'conversation', conversation_id: 'conversation/1' },
      expires_at: '2099-09-01T12:00:00Z',
      trace_id: 'trace-1',
    });
    state.acknowledgeTarget.mockResolvedValue(undefined);
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

    await expect(acknowledgeResolvedConversationDeepLink({ id: 'conversation/1' })).resolves.toBe(true);
    expect(state.acknowledgeTarget).toHaveBeenCalledWith({
      navigation_intent_id: 'intent-1',
      idempotency_key: expect.stringMatching(/^gea-ui-/),
    });
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
    act(() => state.received?.({ action: 'open-conversation', params: { ref: 'unsafe~reference', v: '1' } }));

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
        navigation_intent_id: 'intent-1',
        schema_version: 1,
        target: { type: 'conversation', conversation_id: 'conversation/1' },
        expires_at: '2099-09-01T12:00:00Z',
        trace_id: 'trace-1',
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
    await expect(acknowledgeResolvedConversationDeepLink({ id: 'conversation/1' })).resolves.toBe(false);
  });

  it('uses the AionCore-bound Conversation as the V1 visibility authority', async () => {
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant-other' } })
    ).resolves.toBe(true);
    expect(state.acknowledgeTarget).toHaveBeenCalledOnce();
    expect(state.acknowledge).toHaveBeenCalledOnce();
  });

  it('does not clear the native queue when the Gateway visibility ACK fails', async () => {
    state.acknowledgeTarget.mockRejectedValue(new Error('gateway unavailable'));
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant/1' } })
    ).resolves.toBe(false);
    expect(state.acknowledgeTarget).toHaveBeenCalledTimes(3);
    expect(state.acknowledge).not.toHaveBeenCalled();
  });

  it('retries a transient Gateway visibility ACK with the same idempotency key', async () => {
    state.acknowledgeTarget.mockRejectedValueOnce(new Error('gateway unavailable')).mockResolvedValueOnce(undefined);
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(acknowledgeResolvedConversationDeepLink({ id: 'conversation/1' })).resolves.toBe(true);
    expect(state.acknowledgeTarget).toHaveBeenCalledTimes(2);
    expect(state.acknowledgeTarget.mock.calls[0][0].idempotency_key).toBe(
      state.acknowledgeTarget.mock.calls[1][0].idempotency_key
    );
    expect(state.acknowledge).toHaveBeenCalledOnce();
  });

  it('does not blindly retry a Gateway visibility ACK conflict', async () => {
    state.acknowledgeTarget.mockRejectedValue({
      name: 'BackendHttpError',
      status: 409,
      code: 'NAVIGATION_STATE_CONFLICT',
    });
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(acknowledgeResolvedConversationDeepLink({ id: 'conversation/1' })).resolves.toBe(false);
    expect(state.acknowledgeTarget).toHaveBeenCalledOnce();
    expect(state.acknowledge).not.toHaveBeenCalled();
  });

  it('keeps the resolved target retryable when the native queue acknowledgement is unavailable', async () => {
    state.acknowledge.mockRejectedValueOnce(new Error('bridge unavailable'));
    renderHook(() => useDeepLink());
    await emitClaimable(payload);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());

    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant/1' } })
    ).resolves.toBe(false);
    await expect(
      acknowledgeResolvedConversationDeepLink({ id: 'conversation/1', assistant: { id: 'assistant/1' } })
    ).resolves.toBe(true);
    expect(state.acknowledgeTarget).toHaveBeenCalledTimes(2);
  });
});
