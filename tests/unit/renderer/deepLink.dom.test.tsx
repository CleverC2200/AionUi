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

import { acknowledgeResolvedConversationDeepLink, useDeepLink } from '@/renderer/hooks/system/useDeepLink';

const payload: OpenConversationDeepLinkPayload = {
  action: 'open-conversation',
  params: { ref: 'nav_0123456789abcdef', v: '1', profile: 'gea.test' },
};

describe('useDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    act(() => state.received?.(payload));

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
    act(() => state.received?.(payload));

    await waitFor(() => expect(state.resolve).toHaveBeenCalledOnce());
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.acknowledge).not.toHaveBeenCalled();
    expect(state.reportFailure).toHaveBeenCalledWith({
      navigation_reference: payload.params.ref,
      result_code: 'DEEP_LINK_RESOLVE_FAILED',
    });
  });

  it('fails closed when the loaded Conversation belongs to another Assistant', async () => {
    renderHook(() => useDeepLink());
    act(() => state.received?.(payload));
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
});
