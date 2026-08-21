/**
 * @vitest-environment jsdom
 */

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The loop warning is the only "detect → warn → stop" path this feature has, and
 * its payload user_id is a Core identity. AuthContext can be empty on desktop,
 * or expose a Feishu/Lark external id that is not equal to the Core id, so it is
 * not a valid source for this filter. The pure-function tests stayed green
 * because they always supplied a matching id by hand.
 *
 * These tests pin the hook level instead: the hook must resolve the Core id,
 * show THIS client's events, and withhold both another Core user's event and an
 * event carrying the current user's unrelated external id.
 */

import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionMessageRateLimitedPayload } from '@/renderer/hooks/system/useCrossSessionRateLimitNotice';

const currentUserInvoke = vi.fn();
const stopInvoke = vi.fn();
const notificationWarning = vi.fn();
const setEnabled = vi.fn();
/** The handler the hook registers on the WS event, captured per render. */
let registered: ((payload: SessionMessageRateLimitedPayload) => void) | null = null;
let registrationCount = 0;

vi.mock('@/common', () => ({
  ipcBridge: {
    auth: {
      currentUser: { invoke: () => currentUserInvoke() },
    },
    sessionMessage: {
      rateLimited: {
        on: (callback: (payload: SessionMessageRateLimitedPayload) => void) => {
          registrationCount += 1;
          registered = callback;
          return () => {
            registered = null;
          };
        },
      },
    },
    conversation: {
      stop: { invoke: (params: unknown) => stopInvoke(params) },
    },
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children }: React.PropsWithChildren) => <button type='button'>{children}</button>,
  Message: { error: vi.fn() },
  Notification: {
    warning: (config: unknown) => notificationWarning(config),
    remove: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/hooks/chat/useCrossSessionMessageEnabled', () => ({
  useCrossSessionMessageEnabled: () => ({ enabled: true, setEnabled, refresh: () => {} }),
}));

vi.mock('@/renderer/pages/conversation/runtime/conversationRuntimeViewStore', () => ({
  getConversationRuntimeViewSnapshot: () => ({ activeTurnId: 'turn_1' }),
}));

const { useCrossSessionRateLimitNotice } = await import('@/renderer/hooks/system/useCrossSessionRateLimitNotice');
const { resetCurrentUserIdCache } = await import('@/renderer/hooks/system/currentUserId');

const payload = (overrides: Partial<SessionMessageRateLimitedPayload> = {}): SessionMessageRateLimitedPayload => ({
  user_id: 'system_default_user',
  from_conversation_id: 'c1',
  from_name: 'A',
  to_conversation_id: 'c2',
  to_name: 'B',
  window_count: 10,
  gate: 'pair',
  ...overrides,
});

const Host: React.FC<{ externalUserId?: string }> = ({ externalUserId }) => {
  useCrossSessionRateLimitNotice();
  return <span data-external-user-id={externalUserId} />;
};

describe('useCrossSessionRateLimitNotice — resolving the current user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registered = null;
    registrationCount = 0;
    resetCurrentUserIdCache();
    // Shape after `httpRequest` unwraps the backend's `{ success, data }`.
    currentUserInvoke.mockResolvedValue({ id: 'system_default_user', username: 'admin' });
  });

  /** The desktop case: AuthContext hands the hook nothing. */
  it('shows the notice when the caller supplies no id, by asking the backend who this client is', async () => {
    render(<Host />);
    await waitFor(() => expect(currentUserInvoke).toHaveBeenCalled());
    // Re-subscribed with the resolved id; the latest handler is the live one.
    await waitFor(() => expect(registrationCount).toBeGreaterThanOrEqual(2));

    act(() => {
      registered?.(payload());
    });

    expect(notificationWarning).toHaveBeenCalledTimes(1);
  });

  /** The fallback must not become a hole in the per-user filter. */
  it('still withholds another user_id even when the id came from the backend', async () => {
    render(<Host />);
    await waitFor(() => expect(currentUserInvoke).toHaveBeenCalled());
    await waitFor(() => expect(registrationCount).toBeGreaterThanOrEqual(2));

    act(() => {
      registered?.(payload({ user_id: 'someone_else' }));
    });

    expect(notificationWarning).not.toHaveBeenCalled();
  });

  it('uses the Core id when the authenticated Feishu/Lark external id is different', async () => {
    render(<Host externalUserId='ou_lark_external_user' />);
    await waitFor(() => expect(currentUserInvoke).toHaveBeenCalled());
    await waitFor(() => expect(registrationCount).toBeGreaterThanOrEqual(2));

    act(() => {
      registered?.(payload({ user_id: 'ou_lark_external_user' }));
    });
    expect(notificationWarning).not.toHaveBeenCalled();

    act(() => {
      registered?.(payload({ user_id: 'system_default_user' }));
    });
    expect(notificationWarning).toHaveBeenCalledTimes(1);
  });

  /** A failed lookup must not throw inside a render effect. */
  it('degrades quietly when the lookup fails', async () => {
    currentUserInvoke.mockRejectedValue(new Error('backend down'));
    render(<Host />);
    await waitFor(() => expect(currentUserInvoke).toHaveBeenCalled());

    act(() => {
      registered?.(payload());
    });

    expect(notificationWarning).not.toHaveBeenCalled();
  });
});
