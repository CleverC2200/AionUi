import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CoreSessionClient,
  type CoreExternalIdentity,
  type CoreSessionClientError,
} from '../../src/core-session-client.js';

const identity: CoreExternalIdentity = {
  provider: 'lark',
  issuer: 'https://gea.example/gea-boot',
  tenant_id: 'tenant-1',
  subject: 'user-1',
};

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('CoreSessionClient', () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
  });

  it('consumes the bootstrap secret before later child environment construction', async () => {
    const previous = process.env.AIONCORE_BOOTSTRAP_SECRET;
    vi.resetModules();
    process.env.AIONCORE_BOOTSTRAP_SECRET = 'server-only-secret';
    try {
      const module = await import('../../src/core-session-client.js');
      expect(module.getCoreSessionBootstrapSecret()).toBe('server-only-secret');
      expect(process.env.AIONCORE_BOOTSTRAP_SECRET).toBeUndefined();
      const { buildSpawnEnv } = await import('../../src/backend-launcher.js');
      expect(buildSpawnEnv()).not.toHaveProperty('AIONCORE_BOOTSTRAP_SECRET');
    } finally {
      if (previous === undefined) delete process.env.AIONCORE_BOOTSTRAP_SECRET;
      else process.env.AIONCORE_BOOTSTRAP_SECRET = previous;
    }
  });

  it('exchanges the exact Lark identity tuple and keeps both renewable Core cookies server-side', async () => {
    let requestBody: unknown;
    let bootstrapHeader = '';
    const server = await startServer(async (req, res) => {
      requestBody = await readJson(req);
      bootstrapHeader = String(req.headers['x-aioncore-bootstrap-secret'] ?? '');
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': [
          'aionui-session=access-1; Path=/; HttpOnly; SameSite=Lax; Max-Age=900',
          'aionui-refresh-session=sid-1.refresh-1; Path=/api/auth/internal/external-sessions; HttpOnly; SameSite=Lax; Max-Age=2592000',
          'aionui-csrf-token=csrf-1; Path=/; SameSite=Strict',
        ],
      });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            user: { id: 'core-user-1', username: 'zhangsan' },
            session_generation: 3,
            session: {
              sid: 'sid-1',
              rotation: 0,
              access_expires_at: 2_000_000_000,
              refresh_expires_at: 2_002_591_100,
            },
          },
        })
      );
    });
    closeServer = server.close;

    const result = await new CoreSessionClient(server.port, 'bootstrap-secret').exchange(identity);

    expect(bootstrapHeader).toBe('bootstrap-secret');
    expect(requestBody).toEqual({ identity });
    expect(result).toEqual({
      accessCookie: 'aionui-session=access-1',
      csrfCookie: 'aionui-csrf-token=csrf-1',
      refreshCookie: 'aionui-refresh-session=sid-1.refresh-1',
      user: { id: 'core-user-1', username: 'zhangsan' },
      sessionGeneration: 3,
      session: {
        sid: 'sid-1',
        rotation: 0,
        accessExpiresAt: 2_000_000_000_000,
        refreshExpiresAt: 2_002_591_100_000,
      },
    });
    expect(JSON.stringify(result)).not.toContain('bootstrap-secret');
  });

  it('refreshes with only the Core refresh cookie and an empty body', async () => {
    let requestBody = Buffer.alloc(0);
    let requestCookie = '';
    let idempotencyKey = '';
    const server = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      requestBody = Buffer.concat(chunks);
      requestCookie = String(req.headers.cookie ?? '');
      idempotencyKey = String(req.headers['x-aioncore-refresh-idempotency-key'] ?? '');
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': [
          'aionui-session=access-2; Path=/; HttpOnly; SameSite=Lax; Max-Age=900',
          'aionui-refresh-session=sid-1.refresh-2; Path=/api/auth/internal/external-sessions; HttpOnly; SameSite=Lax; Max-Age=2592000',
          'aionui-csrf-token=csrf-2; Path=/; SameSite=Strict',
        ],
      });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            session: {
              sid: 'sid-1',
              rotation: 1,
              access_expires_at: 2_000_000_900,
              refresh_expires_at: 2_002_592_000,
            },
          },
        })
      );
    });
    closeServer = server.close;

    const refreshIdempotencyKey = 'A'.repeat(43);
    const result = await new CoreSessionClient(server.port, 'bootstrap-secret').refresh(
      'aionui-refresh-session=sid-1.refresh-1',
      refreshIdempotencyKey
    );

    expect(requestBody).toHaveLength(0);
    expect(requestCookie).toBe('aionui-refresh-session=sid-1.refresh-1');
    expect(idempotencyKey).toBe(refreshIdempotencyKey);
    expect(result).toEqual({
      accessCookie: 'aionui-session=access-2',
      csrfCookie: 'aionui-csrf-token=csrf-2',
      refreshCookie: 'aionui-refresh-session=sid-1.refresh-2',
      session: {
        sid: 'sid-1',
        rotation: 1,
        accessExpiresAt: 2_000_000_900_000,
        refreshExpiresAt: 2_002_592_000_000,
      },
    });
  });

  it('provisions the exact Lark identity tuple before exchange without returning credentials', async () => {
    let method = '';
    let requestBody: unknown;
    let bootstrapHeader = '';
    const server = await startServer(async (req, res) => {
      method = req.method ?? '';
      requestBody = await readJson(req);
      bootstrapHeader = String(req.headers['x-aioncore-bootstrap-secret'] ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { core_user_id: 'core-user-1', created: true } }));
    });
    closeServer = server.close;

    const result = await new CoreSessionClient(server.port, 'bootstrap-secret').ensureMapping(identity);

    expect(method).toBe('PUT');
    expect(bootstrapHeader).toBe('bootstrap-secret');
    expect(requestBody).toEqual({ identity });
    expect(result).toEqual({ coreUserId: 'core-user-1', created: true });
    expect(JSON.stringify(result)).not.toMatch(/bootstrap-secret|aionui-session/);
  });

  it('revokes only the exact identity through the trusted route', async () => {
    let requestPath = '';
    let requestBody: unknown;
    const server = await startServer(async (req, res) => {
      requestPath = req.url ?? '';
      requestBody = await readJson(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { user_id: 'core-user-1', session_generation: 4 } }));
    });
    closeServer = server.close;

    await expect(new CoreSessionClient(server.port, 'bootstrap-secret').revoke(identity)).resolves.toEqual({
      userId: 'core-user-1',
      sessionGeneration: 4,
    });
    expect(requestPath).toBe('/api/auth/internal/external-sessions/revoke');
    expect(requestBody).toEqual({ identity });
  });

  it('revokes only the matching sid with the refresh cookie and an empty body', async () => {
    let requestPath = '';
    let requestBody = Buffer.alloc(0);
    let requestCookie = '';
    const server = await startServer(async (req, res) => {
      requestPath = req.url ?? '';
      requestCookie = String(req.headers.cookie ?? '');
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      requestBody = Buffer.concat(chunks);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { sid: 'sid-1', revoked: true } }));
    });
    closeServer = server.close;

    await expect(
      new CoreSessionClient(server.port, 'bootstrap-secret').revokeMatching('aionui-refresh-session=sid-1.refresh-1')
    ).resolves.toEqual({ sid: 'sid-1', revoked: true });
    expect(requestPath).toBe('/api/auth/internal/external-sessions/revoke-matching');
    expect(requestBody).toHaveLength(0);
    expect(requestCookie).toBe('aionui-refresh-session=sid-1.refresh-1');
  });

  it('fails closed when Core omits its session cookie', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          data: { user: { id: 'core-user-1', username: 'zhangsan' }, session_generation: 3 },
        })
      );
    });
    closeServer = server.close;

    await expect(new CoreSessionClient(server.port, 'bootstrap-secret').exchange(identity)).rejects.toMatchObject({
      code: 'CORE_SESSION_RESPONSE_INVALID',
    } satisfies Partial<CoreSessionClientError>);
  });

  it('reports only the stable Core error code without retaining response payloads', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          code: 'USER_CONTEXT_REQUIRED',
          message: 'must-not-be-retained',
          credential: 'must-not-leak',
        })
      );
    });
    closeServer = server.close;

    const error = await new CoreSessionClient(server.port, 'bootstrap-secret')
      .exchange(identity)
      .catch((value) => value);

    expect(error).toMatchObject({ status: 401, code: 'USER_CONTEXT_REQUIRED' });
    expect(JSON.stringify(error)).not.toContain('must-not');
  });
});
