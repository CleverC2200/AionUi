import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreSessionClientError, type CoreSession, type CoreSessionRefresh } from '../../src/core-session-client.js';
import { LarkAuthGateway, type CoreSessionPort, type LarkAuthGatewayClock } from '../../src/lark-auth-gateway.js';
import type { WebHostLarkAuth } from '../../src/types.js';

const NOW = 1_700_000_000_000;

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function coreSession(id: number, accessMs = 90_000): CoreSession {
  return {
    accessCookie: `aionui-session=access-${id}`,
    csrfCookie: `aionui-csrf-token=csrf-${id}`,
    refreshCookie: `aionui-refresh-session=sid-${id}.refresh-${id}`,
    sessionGeneration: 1,
    session: {
      accessExpiresAt: NOW + accessMs,
      refreshExpiresAt: NOW + 2_592_000_000,
      rotation: 0,
      sid: `sid-${id}`,
    },
    user: { id: 'same-core-user', username: 'same-user' },
  };
}

function refreshedSession(id: number): CoreSessionRefresh {
  return {
    accessCookie: `aionui-session=access-${id}-rotated`,
    csrfCookie: `aionui-csrf-token=csrf-${id}-rotated`,
    refreshCookie: `aionui-refresh-session=sid-${id}.refresh-${id}-rotated`,
    session: {
      accessExpiresAt: NOW + 960_000,
      refreshExpiresAt: NOW + 2_592_900_000,
      rotation: 1,
      sid: `sid-${id}`,
    },
  };
}

function createCorePort(exchangeResults: CoreSession[]): CoreSessionPort {
  return {
    ensureMapping: vi.fn().mockResolvedValue({ coreUserId: 'same-core-user', created: false }),
    exchange: vi.fn().mockImplementation(async () => {
      const session = exchangeResults.shift();
      if (!session) throw new Error('unexpected exchange');
      return session;
    }),
    refresh: vi.fn(),
    revokeMatching: vi.fn().mockResolvedValue({ sid: 'sid-1', revoked: true }),
  };
}

function createLarkAuth(): WebHostLarkAuth {
  return {
    createQrSession: async () => ({
      success: true,
      data: { expiresIn: 300, loginUrl: 'https://gea.example/login', qrcodeId: 'qr-1' },
    }),
    pollQrSession: async (qrcodeId) => ({
      identity: {
        provider: 'lark',
        issuer: 'https://gea.example/gea-boot',
        tenant_id: 'tenant-1',
        subject: 'same-lark-user',
      },
      publicResult: {
        success: true,
        data: {
          status: 'authenticated',
          user: { id: 'same-lark-user', username: qrcodeId, realname: 'Same User' },
        },
      },
    }),
  };
}

class FakeClock implements LarkAuthGatewayClock {
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  nowValue = NOW;

  now = (): number => this.nowValue;

  setTimeout = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowValue + delayMs, callback });
    return { id, unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
  };

  clearTimeout = (timer: ReturnType<typeof setTimeout>): void => {
    this.timers.delete((timer as unknown as { id: number }).id);
  };

  async advance(ms: number): Promise<void> {
    this.nowValue += ms;
    await this.runDueTimers();
  }

  private async runDueTimers(): Promise<void> {
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.nowValue)
      .toSorted((left, right) => left[1].at - right[1].at)[0];
    if (!due) return;
    this.timers.delete(due[0]);
    due[1].callback();
    await Promise.resolve();
    await Promise.resolve();
    await this.runDueTimers();
  }
}

function upgradeRequest(webCookie: string): Buffer {
  return Buffer.from(
    `GET /ws HTTP/1.1\r\nHost: localhost\r\nCookie: ${webCookie}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
    'latin1'
  );
}

async function startGatewayServer(gateway: LarkAuthGateway): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const server = http.createServer((req, res) => {
    void gateway.handleRequest(req, res).then((handled) => {
      if (!handled && !res.headersSent) res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    url: `http://127.0.0.1:${port}`,
  };
}

async function login(url: string, qrcodeId: string): Promise<string> {
  const response = await fetch(`${url}/api/lark-auth/poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qrcodeId }),
  });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
}

describe('LarkAuthGateway renewable Core sessions', () => {
  const closes: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closes.splice(0).map((close) => close()));
  });

  it.each([
    { coreLifetimeMs: 30 * 24 * 60 * 60 * 1000, expectedMaxAge: 30 * 24 * 60 * 60 },
    { coreLifetimeMs: 12 * 60 * 60 * 1000 + 500, expectedMaxAge: 12 * 60 * 60 },
    { coreLifetimeMs: 45 * 24 * 60 * 60 * 1000, expectedMaxAge: 30 * 24 * 60 * 60 },
  ])(
    'bounds the browser WebSession lifetime by the Core durable expiry ($expectedMaxAge seconds)',
    async ({ coreLifetimeMs, expectedMaxAge }) => {
      const clock = new FakeClock();
      const initial = coreSession(1);
      initial.session.refreshExpiresAt = NOW + coreLifetimeMs;
      const core = createCorePort([initial]);
      const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
      const server = await startGatewayServer(gateway);
      closes.push(server.close);

      const response = await fetch(`${server.url}/api/lark-auth/poll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qrcodeId: 'qr-1' }),
      });

      expect(response.status).toBe(200);
      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain(`Max-Age=${expectedMaxAge}`);
      const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
      expect(maxAge * 1000).toBeLessThanOrEqual(coreLifetimeMs);
    }
  );

  it('single-flights concurrent HTTP and WebSocket refresh with one idempotency key', async () => {
    const clock = new FakeClock();
    const core = createCorePort([coreSession(1, 30_000)]);
    const refresh = deferred<CoreSessionRefresh>();
    vi.mocked(core.refresh).mockReturnValue(refresh.promise);
    const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
    const server = await startGatewayServer(gateway);
    closes.push(server.close);
    const webCookie = await login(server.url, 'qr-1');

    const httpHeaders = gateway.getBackendHeaders({ cookie: webCookie });
    const upgrade = gateway.authorizeUpgrade(upgradeRequest(webCookie));
    expect(core.refresh).toHaveBeenCalledTimes(1);

    refresh.resolve(refreshedSession(1));
    const authorizedHeaders = await httpHeaders;
    const authorizedUpgrade = await upgrade;
    expect(authorizedHeaders).toMatchObject({
      cookie: 'aionui-session=access-1-rotated; aionui-csrf-token=csrf-1-rotated',
      'x-csrf-token': 'csrf-1-rotated',
    });
    expect(authorizedUpgrade).toEqual(expect.any(Buffer));
    expect(authorizedUpgrade?.toString('latin1')).toContain('Cookie: aionui-session=access-1-rotated');
    expect(JSON.stringify(authorizedHeaders)).not.toContain('refresh-1-rotated');
    expect(authorizedUpgrade?.toString('latin1')).not.toContain('refresh-1-rotated');
    const [, idempotencyKey] = vi.mocked(core.refresh).mock.calls[0];
    expect(idempotencyKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('reuses the logical refresh idempotency key across bounded 5xx retry', async () => {
    const clock = new FakeClock();
    const core = createCorePort([coreSession(1)]);
    vi.mocked(core.refresh)
      .mockRejectedValueOnce(new CoreSessionClientError('EXTERNAL_SESSION_UNAVAILABLE', 503))
      .mockResolvedValueOnce(refreshedSession(1));
    const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
    const server = await startGatewayServer(gateway);
    closes.push(server.close);
    const webCookie = await login(server.url, 'qr-1');

    await clock.advance(30_000);
    expect(core.refresh).toHaveBeenCalledTimes(1);
    await clock.advance(1_000);
    expect(core.refresh).toHaveBeenCalledTimes(2);
    expect(vi.mocked(core.refresh).mock.calls[1]).toEqual(vi.mocked(core.refresh).mock.calls[0]);
    await expect(gateway.getBackendHeaders({ cookie: webCookie })).resolves.toMatchObject({
      cookie: 'aionui-session=access-1-rotated; aionui-csrf-token=csrf-1-rotated',
    });
  });

  it('retries 5xx only until the access deadline and then fails the WebSession closed', async () => {
    const clock = new FakeClock();
    const core = createCorePort([coreSession(1, 60_000)]);
    vi.mocked(core.refresh).mockRejectedValue(new CoreSessionClientError('EXTERNAL_SESSION_UNAVAILABLE', 503));
    const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
    const server = await startGatewayServer(gateway);
    closes.push(server.close);
    const webCookie = await login(server.url, 'qr-1');

    await clock.advance(0);
    await clock.advance(1_000);
    await clock.advance(2_000);
    await clock.advance(4_000);
    await clock.advance(8_000);
    await clock.advance(16_000);
    await clock.advance(29_000);

    expect(core.refresh).toHaveBeenCalledTimes(6);
    const keys = vi.mocked(core.refresh).mock.calls.map(([, key]) => key);
    expect(new Set(keys).size).toBe(1);
    await expect(gateway.getBackendHeaders({ cookie: webCookie })).resolves.toBeNull();
  });

  it.each([
    ['EXTERNAL_SESSION_REFRESH_REPLAYED', 401],
    ['EXTERNAL_SESSION_EXPIRED', 401],
    ['EXTERNAL_SESSION_REVOKED', 401],
    ['EXTERNAL_SESSION_GENERATION_MISMATCH', 401],
    ['EXTERNAL_SESSION_REFRESH_INVALID', 401],
    ['EXTERNAL_SESSION_REFRESH_REQUIRED', 401],
    ['CORE_USER_DISABLED', 403],
    ['UNRECOGNIZED_REFRESH_CLIENT_ERROR', 400],
  ])('fails the non-retryable refresh error %s closed', async (code, status) => {
    const clock = new FakeClock();
    const core = createCorePort([coreSession(1, 30_000)]);
    vi.mocked(core.refresh).mockRejectedValue(new CoreSessionClientError(code, status));
    const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
    const server = await startGatewayServer(gateway);
    closes.push(server.close);
    const webCookie = await login(server.url, 'qr-1');

    await expect(gateway.getBackendHeaders({ cookie: webCookie })).resolves.toBeNull();
    expect(core.refresh).toHaveBeenCalledTimes(1);

    const response = await fetch(`${server.url}/api/auth/user`, { headers: { cookie: webCookie } });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it.each(['EXTERNAL_SESSION_REFRESH_IDEMPOTENCY_REQUIRED', 'EXTERNAL_SESSION_REFRESH_IDEMPOTENCY_INVALID'])(
    'keeps valid access after the retryable idempotency error %s',
    async (code) => {
      const clock = new FakeClock();
      const core = createCorePort([coreSession(1, 30_000)]);
      vi.mocked(core.refresh)
        .mockRejectedValueOnce(new CoreSessionClientError(code, 400))
        .mockResolvedValueOnce(refreshedSession(1));
      const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
      const server = await startGatewayServer(gateway);
      closes.push(server.close);
      const webCookie = await login(server.url, 'qr-1');

      await expect(gateway.getBackendHeaders({ cookie: webCookie })).resolves.toMatchObject({
        cookie: 'aionui-session=access-1; aionui-csrf-token=csrf-1',
      });
      await clock.advance(1_000);

      expect(core.refresh).toHaveBeenCalledTimes(2);
      expect(vi.mocked(core.refresh).mock.calls[1]).toEqual(vi.mocked(core.refresh).mock.calls[0]);
      await expect(gateway.getBackendHeaders({ cookie: webCookie })).resolves.toMatchObject({
        cookie: 'aionui-session=access-1-rotated; aionui-csrf-token=csrf-1-rotated',
      });
    }
  );

  it.each([
    {
      name: 'expired access metadata',
      mutate: (refresh: CoreSessionRefresh) => {
        refresh.session.accessExpiresAt = NOW;
      },
    },
    {
      name: 'a skipped rotation',
      mutate: (refresh: CoreSessionRefresh) => {
        refresh.session.rotation = 2;
      },
    },
  ])('rejects $name without scheduling a zero-delay refresh loop', async ({ mutate }) => {
    const clock = new FakeClock();
    const core = createCorePort([coreSession(1, 30_000)]);
    const stale = refreshedSession(1);
    mutate(stale);
    vi.mocked(core.refresh).mockResolvedValue(stale);
    const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
    const server = await startGatewayServer(gateway);
    closes.push(server.close);
    const webCookie = await login(server.url, 'qr-1');

    await expect(gateway.getBackendHeaders({ cookie: webCookie })).resolves.toBeNull();
    await clock.advance(60_000);

    expect(core.refresh).toHaveBeenCalledTimes(1);
    await expect(gateway.getBackendHeaders({ cookie: webCookie })).resolves.toBeNull();
  });

  it('revokes only one of two same-user sessions and forgets all Core cookies on restart', async () => {
    const clock = new FakeClock();
    const core = createCorePort([coreSession(1), coreSession(2)]);
    const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
    const server = await startGatewayServer(gateway);
    closes.push(server.close);
    const cookieA = await login(server.url, 'qr-a');
    const cookieB = await login(server.url, 'qr-b');

    await fetch(`${server.url}/api/lark-auth/logout`, { method: 'POST', headers: { cookie: cookieA } });

    expect(core.revokeMatching).toHaveBeenCalledWith('aionui-refresh-session=sid-1.refresh-1');
    await expect(gateway.getBackendHeaders({ cookie: cookieA })).resolves.toBeNull();
    await expect(gateway.getBackendHeaders({ cookie: cookieB })).resolves.toMatchObject({
      cookie: 'aionui-session=access-2; aionui-csrf-token=csrf-2',
    });

    gateway.dispose();
    const restarted = new LarkAuthGateway(createLarkAuth(), createCorePort([]), clock);
    await expect(restarted.getBackendHeaders({ cookie: cookieB })).resolves.toBeNull();
  });

  it('does not let a refresh response racing with logout resurrect the WebSession', async () => {
    const clock = new FakeClock();
    const core = createCorePort([coreSession(1, 30_000)]);
    const refresh = deferred<CoreSessionRefresh>();
    vi.mocked(core.refresh).mockReturnValue(refresh.promise);
    const gateway = new LarkAuthGateway(createLarkAuth(), core, clock);
    const server = await startGatewayServer(gateway);
    closes.push(server.close);
    const webCookie = await login(server.url, 'qr-1');
    const authorizing = gateway.getBackendHeaders({ cookie: webCookie });
    const logout = fetch(`${server.url}/api/lark-auth/logout`, { method: 'POST', headers: { cookie: webCookie } });

    await vi.waitFor(() => expect(core.refresh).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresh.resolve(refreshedSession(1));
    await expect(authorizing).resolves.toBeNull();
    const response = await logout;

    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(core.revokeMatching).toHaveBeenCalledWith('aionui-refresh-session=sid-1.refresh-1-rotated');
    await expect(gateway.getBackendHeaders({ cookie: webCookie })).resolves.toBeNull();
  });
});
