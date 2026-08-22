import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotificationClick } from '@/renderer/hooks/system/notification/useNotificationClick';

const state = vi.hoisted(() => ({
  auth: { status: 'authenticated', user: { id: 'user-1' } } as {
    status: 'authenticated' | 'unauthenticated';
    user: { id: string } | null;
  },
  navigate: vi.fn(),
  clicked: undefined as
    | ((payload: {
        notification_id?: string;
        notification_version?: string;
        scope_id?: string;
        conversation_id?: string;
        target?: { type: 'conversation'; conversationId: string };
      }) => void)
    | undefined,
  off: vi.fn(),
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('@/common', () => ({
  ipcBridge: {
    notification: {
      clicked: {
        on: (callback: NonNullable<typeof state.clicked>) => {
          state.clicked = callback;
          return state.off;
        },
      },
    },
  },
}));

describe('useNotificationClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth = { status: 'authenticated', user: { id: 'user-1' } };
    state.clicked = undefined;
  });

  it('routes a typed native notification only inside the originating identity scope', () => {
    renderHook(() => useNotificationClick());
    state.clicked?.({
      notification_id: 'notification-1',
      notification_version: 'v1',
      scope_id: 'user-1',
      target: { type: 'conversation', conversationId: 'conversation-1' },
    });

    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-1', { state: undefined });
  });

  it('ignores a delayed native click after the account changes', () => {
    const { rerender } = renderHook(() => useNotificationClick());
    state.auth = { status: 'authenticated', user: { id: 'user-2' } };
    rerender();

    state.clicked?.({
      notification_id: 'notification-1',
      notification_version: 'v1',
      scope_id: 'user-1',
      target: { type: 'conversation', conversationId: 'conversation-1' },
    });

    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('keeps legacy conversation notifications compatible', () => {
    renderHook(() => useNotificationClick());
    state.clicked?.({ conversation_id: 'conversation-legacy' });

    expect(state.navigate).toHaveBeenCalledWith('/conversation/conversation-legacy');
  });
});
