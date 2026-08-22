/**
 * @vitest-environment jsdom
 */

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const resumeRealtimeWebSocketMock = vi.hoisted(() => vi.fn());

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  resumeRealtimeWebSocket: resumeRealtimeWebSocketMock,
}));

type AuthModule = typeof import('@renderer/hooks/context/AuthContext');

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let AuthProvider: AuthModule['AuthProvider'];
let resetAuthSessionEpochForTests: AuthModule['resetAuthSessionEpochForTests'];
let useAuth: AuthModule['useAuth'];
const originalElectronApi = window.electronAPI;

beforeAll(async () => {
  delete window.electronAPI;
  vi.resetModules();
  ({ AuthProvider, resetAuthSessionEpochForTests, useAuth } = await import('@renderer/hooks/context/AuthContext'));
});

afterAll(() => {
  window.electronAPI = originalElectronApi;
});

const Probe = () => {
  const { authSessionEpoch, logout, pollLarkQrLogin, startLarkQrLogin, status, user } = useAuth();
  const [qrcodeId, setQrcodeId] = useState('');

  return (
    <div>
      <span>{status}</span>
      <span>{user?.realname}</span>
      <span>{qrcodeId}</span>
      <span data-testid='auth-session-epoch'>{authSessionEpoch}</span>
      <button
        onClick={() =>
          void startLarkQrLogin().then((result) => {
            if (result.success) setQrcodeId(result.data.qrcodeId);
          })
        }
      >
        start
      </button>
      <button onClick={() => void pollLarkQrLogin('qr-1')}>poll</button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
};

describe('WebUI AuthProvider', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetAuthSessionEpochForTests();
    resumeRealtimeWebSocketMock.mockReset();
    (window as Window & { __websocketReconnect?: (authSessionEpoch: number) => void }).__websocketReconnect = vi.fn();
    fetchMock.mockReset().mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === '/api/auth/user') {
        return new Response(JSON.stringify({ success: false }), { status: 401 });
      }
      if (path === '/api/lark-auth/qr-session') {
        return Response.json({
          success: true,
          data: { expiresIn: 300, loginUrl: 'https://gea.example/login', qrcodeId: 'qr-1' },
        });
      }
      if (path === '/api/lark-auth/poll') {
        expect(init?.credentials).toBe('include');
        return Response.json({
          success: true,
          data: {
            status: 'authenticated',
            user: { id: 'user-1', username: 'zhangsan', realname: '张三' },
          },
        });
      }
      if (path === '/api/lark-auth/logout') {
        return Response.json({ success: true, data: { authenticated: false } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('uses Lark QR endpoints and publishes the Feishu user', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument());
    fireEvent.click(screen.getByText('start'));
    await waitFor(() => expect(screen.getByText('qr-1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('poll'));
    await waitFor(() => expect(screen.getByText('张三')).toBeInTheDocument());
    expect(screen.getByText('authenticated')).toBeInTheDocument();

    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lark-auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
  });

  it('publishes a new auth epoch when the same identity establishes another WebHost session', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument());
    fireEvent.click(screen.getByText('poll'));
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());
    const firstEpoch = Number(screen.getByTestId('auth-session-epoch').textContent);

    fireEvent.click(screen.getByText('poll'));
    await waitFor(() =>
      expect(Number(screen.getByTestId('auth-session-epoch').textContent)).toBeGreaterThan(firstEpoch)
    );
    const secondEpoch = Number(screen.getByTestId('auth-session-epoch').textContent);

    const reconnect = (window as Window & { __websocketReconnect?: ReturnType<typeof vi.fn> }).__websocketReconnect;
    expect(reconnect).toHaveBeenNthCalledWith(1, firstEpoch);
    expect(reconnect).toHaveBeenNthCalledWith(2, secondEpoch);
    expect(resumeRealtimeWebSocketMock).toHaveBeenNthCalledWith(1, firstEpoch);
    expect(resumeRealtimeWebSocketMock).toHaveBeenNthCalledWith(2, secondEpoch);
  });

  it('does not let a late status response re-authenticate after logout', async () => {
    const statusResponse = deferred<Response>();
    fetchMock.mockImplementation(async (input) => {
      const path = String(input);
      if (path === '/api/auth/user') return statusResponse.promise;
      if (path === '/api/lark-auth/logout') {
        return Response.json({ success: true, data: { authenticated: false } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/user', expect.anything()));

    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument());
    const statusSignal = fetchMock.mock.calls.find(([input]) => String(input) === '/api/auth/user')?.[1]?.signal;
    expect(statusSignal?.aborted).toBe(true);
    statusResponse.resolve(
      Response.json({
        success: true,
        user: { id: 'user-1', username: 'zhangsan', realname: '张三' },
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('unauthenticated')).toBeInTheDocument();
    expect(screen.queryByText('张三')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/lark-auth/logout', expect.anything());
  });

  it('does not publish or resume a late poll response after logout', async () => {
    const pollResponse = deferred<Response>();
    fetchMock.mockImplementation(async (input) => {
      const path = String(input);
      if (path === '/api/auth/user') return new Response(JSON.stringify({ success: false }), { status: 401 });
      if (path === '/api/lark-auth/poll') return pollResponse.promise;
      if (path === '/api/lark-auth/logout') {
        return Response.json({ success: true, data: { authenticated: false } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument());

    fireEvent.click(screen.getByText('poll'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/lark-auth/poll', expect.anything()));
    fireEvent.click(screen.getByText('logout'));
    const pollSignal = fetchMock.mock.calls.find(([input]) => String(input) === '/api/lark-auth/poll')?.[1]?.signal;
    expect(pollSignal?.aborted).toBe(true);
    pollResponse.resolve(
      Response.json({
        success: true,
        data: {
          status: 'authenticated',
          user: { id: 'user-1', username: 'zhangsan', realname: '张三' },
        },
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('unauthenticated')).toBeInTheDocument();
    expect(screen.queryByText('张三')).not.toBeInTheDocument();
    expect(
      (window as Window & { __websocketReconnect?: ReturnType<typeof vi.fn> }).__websocketReconnect
    ).not.toHaveBeenCalled();
    expect(resumeRealtimeWebSocketMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/lark-auth/logout', expect.anything());
  });
});
