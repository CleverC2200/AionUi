import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import netModule from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startStaticServer, type StaticServerHandle } from '../../src/static-server.js';
import type { WebHostLarkAuth } from '../../src/types.js';

async function mkRendererFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-static-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>root</title>');
  await fs.mkdir(path.join(dir, 'assets'));
  await fs.writeFile(path.join(dir, 'assets', 'main.js'), 'console.log("hi")');
  return dir;
}

async function startMockBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ port: number; server: http.Server; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    server,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function readRequestJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

describe('static-server', () => {
  let handle: StaticServerHandle | null = null;
  let stopBackend: (() => Promise<void>) | null = null;
  let staticDir = '';

  beforeEach(async () => {
    staticDir = await mkRendererFixture();
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    if (stopBackend) {
      await stopBackend();
      stopBackend = null;
    }
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  it('serves static index.html at /', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('<title>root</title>');
  });

  it('SPA fallback: /chat/123 returns index.html', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/chat/123`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>root</title>');
  });

  it('static asset /assets/main.js served', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/assets/main.js`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('hi');
  });

  it('/api/* reverse-proxies to backend', async () => {
    const backend = await startMockBackend((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/anything`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { path: string };
    expect(json.path).toBe('/api/anything');
  });

  it('blocks trusted Core routes and strips only the bootstrap header without Lark auth', async () => {
    let trustedRequests = 0;
    let publicHeaders: http.IncomingHttpHeaders | undefined;
    const backend = await startMockBackend((req, res) => {
      if (req.url?.startsWith('/api/auth/internal/')) trustedRequests += 1;
      if (req.url === '/api/anything') publicHeaders = req.headers;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const trustedResponse = await fetch(`${handle.localUrl}/api/auth/internal/external-sessions`, {
      method: 'POST',
      headers: { 'x-aioncore-bootstrap-secret': 'browser-injected' },
    });
    expect(trustedResponse.status).toBe(404);
    expect(trustedRequests).toBe(0);

    const publicResponse = await fetch(`${handle.localUrl}/api/anything`, {
      headers: {
        authorization: 'Bearer public-api-token',
        'x-access-token': 'public-upstream-token',
        'x-aioncore-bootstrap-secret': 'browser-injected',
      },
    });
    expect(publicResponse.status).toBe(200);
    expect(publicHeaders?.['x-aioncore-bootstrap-secret']).toBeUndefined();
    expect(publicHeaders?.authorization).toBe('Bearer public-api-token');
    expect(publicHeaders?.['x-access-token']).toBe('public-upstream-token');
  });

  it('/login reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/login' && req.method === 'POST') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'aionui-session=backend-token; Path=/; HttpOnly',
        });
        res.end(JSON.stringify({ success: true, proxied: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'anything' }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/aionui-session=backend-token/);
    const json = (await r.json()) as { proxied: boolean };
    expect(json.proxied).toBe(true);
  });

  it('/api/auth/user reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/user' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { username: 'from-backend', id: 'from-backend' } }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/api/auth/user`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { user: { username: string } };
    expect(json.user.username).toBe('from-backend');
  });

  it('/logout reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/logout' && req.method === 'POST') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'aionui-session=; Path=/; Max-Age=0',
        });
        res.end(JSON.stringify({ success: true, proxied: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/logout`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('isolates two Lark identities across HTTP, WebSocket, and logout without leaking credentials', async () => {
    const provisionBodies: unknown[] = [];
    const exchangeBodies: unknown[] = [];
    const revokeCookies: string[] = [];
    const trustedBootstrapHeaders: string[] = [];
    const forwardedHeaders: http.IncomingHttpHeaders[] = [];
    const upgradeHeaders: http.IncomingHttpHeaders[] = [];
    let trustedBrowserRequests = 0;
    const backend = await startMockBackend(async (req, res) => {
      if (req.url === '/api/auth/internal/external-identities' && req.method === 'PUT') {
        trustedBootstrapHeaders.push(String(req.headers['x-aioncore-bootstrap-secret'] ?? ''));
        provisionBodies.push(await readRequestJson(req));
        const identity = (provisionBodies.at(-1) as { identity: { subject: string } }).identity;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { core_user_id: `core-${identity.subject}`, created: true } }));
        return;
      }
      if (req.url === '/api/auth/internal/external-sessions' && req.method === 'POST') {
        trustedBootstrapHeaders.push(String(req.headers['x-aioncore-bootstrap-secret'] ?? ''));
        exchangeBodies.push(await readRequestJson(req));
        const identity = (exchangeBodies.at(-1) as { identity: { subject: string } }).identity;
        const now = Math.floor(Date.now() / 1000);
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': [
            `aionui-session=access-${identity.subject}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
            `aionui-refresh-session=sid-${identity.subject}.refresh-${identity.subject}; Path=/api/auth/internal/external-sessions; HttpOnly; SameSite=Lax; Max-Age=2592000`,
            `aionui-csrf-token=csrf-${identity.subject}; Path=/; SameSite=Strict`,
          ],
        });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              user: { id: `core-${identity.subject}`, username: identity.subject },
              session_generation: 1,
              session: {
                sid: `sid-${identity.subject}`,
                rotation: 0,
                access_expires_at: now + 900,
                refresh_expires_at: now + 2_592_000,
              },
            },
          })
        );
        return;
      }
      if (req.url === '/api/auth/internal/external-sessions/revoke-matching' && req.method === 'POST') {
        trustedBootstrapHeaders.push(String(req.headers['x-aioncore-bootstrap-secret'] ?? ''));
        revokeCookies.push(String(req.headers.cookie ?? ''));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { sid: 'sid-user-a', revoked: true } }));
        return;
      }
      if (req.url?.startsWith('/api/auth/internal/')) {
        trustedBrowserRequests += 1;
        res.writeHead(500).end();
        return;
      }
      if (req.url === '/api/anything') {
        forwardedHeaders.push(req.headers);
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'aionui-session=must-not-reach-browser; Path=/; HttpOnly',
        });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      if (req.url === '/api/business-denied') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, code: 'BUSINESS_DENIED' }));
        return;
      }
      if (req.url === '/api/admin-revoked') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, code: 'EXTERNAL_SESSION_GENERATION_MISMATCH' }));
        return;
      }
      res.writeHead(404).end();
    });
    backend.server.on('upgrade', (req, socket) => {
      upgradeHeaders.push(req.headers);
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      socket.end();
    });
    stopBackend = backend.close;

    const identities = {
      'qr-a': {
        provider: 'lark' as const,
        issuer: 'https://gea.example/gea-boot',
        tenant_id: '1001',
        subject: 'user-a',
      },
      'qr-b': {
        provider: 'lark' as const,
        issuer: 'https://gea.example/gea-boot',
        tenant_id: '1002',
        subject: 'user-b',
      },
    };
    const larkAuth = {
      createQrSession: async () => ({
        success: true as const,
        data: {
          expiresIn: 300,
          loginUrl: 'https://gea.example/login',
          qrcodeId: 'qr-1',
          credential: { accessToken: 'must-not-leak' },
        },
        accessToken: 'must-not-leak',
      }),
      pollQrSession: async (qrcodeId: string) => {
        const identity = identities[qrcodeId as keyof typeof identities];
        const user = { id: identity.subject, username: identity.subject, realname: identity.subject };
        return {
          identity: { ...identity, access_token: 'must-not-leak' },
          publicResult: {
            success: true as const,
            data: {
              status: 'authenticated' as const,
              user: { ...user, credential: { accessToken: 'must-not-leak' } },
              accessToken: 'must-not-leak',
            },
          },
          accessToken: 'must-not-leak',
        };
      },
    } satisfies WebHostLarkAuth;
    handle = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      larkAuth,
      coreSessionBootstrapSecret: 'bootstrap-secret',
    });

    expect((await fetch(`${handle.localUrl}/api/anything`)).status).toBe(401);
    const publicPort = handle.port;
    const unauthenticatedUpgradeStatus = await new Promise<string>((resolve, reject) => {
      const socket = netModule.connect({ host: '127.0.0.1', port: publicPort }, () => {
        socket.write(
          'GET /ws HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      socket.on('data', (data) => {
        socket.destroy();
        resolve(data.toString('ascii').split('\r\n', 1)[0]);
      });
      socket.on('error', reject);
    });
    expect(unauthenticatedUpgradeStatus).toContain('401 Unauthorized');

    const qrResponse = await fetch(`${handle.localUrl}/api/lark-auth/qr-session`, { method: 'POST' });
    expect(await qrResponse.json()).toEqual({
      success: true,
      data: { expiresIn: 300, loginUrl: 'https://gea.example/login', qrcodeId: 'qr-1' },
    });

    const login = async (qrcodeId: 'qr-a' | 'qr-b'): Promise<string> => {
      const response = await fetch(`${handle?.localUrl}/api/lark-auth/poll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qrcodeId }),
      });
      const text = await response.text();
      expect(text).not.toMatch(/must-not-leak|bootstrap-secret|aionui-session|identity|issuer|tenant_id|subject/i);
      expect(JSON.parse(text)).toEqual({
        success: true,
        data: {
          status: 'authenticated',
          user: {
            id: qrcodeId === 'qr-a' ? 'user-a' : 'user-b',
            username: qrcodeId === 'qr-a' ? 'user-a' : 'user-b',
            realname: qrcodeId === 'qr-a' ? 'user-a' : 'user-b',
          },
        },
      });
      expect(response.headers.get('set-cookie')).toMatch(
        /^aionui-web-session=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=/
      );
      return response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    };
    const cookieA = await login('qr-a');
    const cookieB = await login('qr-b');

    const expectedIdentityBodies = [{ identity: identities['qr-a'] }, { identity: identities['qr-b'] }];
    expect(provisionBodies).toEqual(expectedIdentityBodies);
    expect(exchangeBodies).toEqual(expectedIdentityBodies);

    const statusA = await fetch(`${handle.localUrl}/api/lark-auth/status`, { headers: { cookie: cookieA } });
    const statusAText = await statusA.text();
    expect(statusAText).not.toMatch(/must-not-leak|bootstrap-secret|aionui-session|issuer|tenant_id/i);
    expect(JSON.parse(statusAText)).toEqual({
      success: true,
      data: {
        authenticated: true,
        user: { id: 'user-a', username: 'user-a', realname: 'user-a' },
      },
    });
    const userB = await fetch(`${handle.localUrl}/api/auth/user`, { headers: { cookie: cookieB } });
    expect(await userB.json()).toEqual({
      success: true,
      user: { id: 'user-b', username: 'user-b', realname: 'user-b' },
    });

    const apiResponses = await Promise.all(
      [cookieA, cookieB].map((cookie) =>
        fetch(`${handle.localUrl}/api/anything`, {
          headers: {
            cookie,
            authorization: 'Bearer injected',
            'x-access-token': 'injected-token',
            'x-aioncore-bootstrap-secret': 'injected-secret',
            'x-csrf-token': 'browser-injected',
          },
        })
      )
    );
    for (const apiResponse of apiResponses) {
      expect(apiResponse.status).toBe(200);
      expect(apiResponse.headers.get('set-cookie')).toBeNull();
    }
    expect(forwardedHeaders.map((headers) => headers.cookie).toSorted()).toEqual([
      'aionui-session=access-user-a; aionui-csrf-token=csrf-user-a',
      'aionui-session=access-user-b; aionui-csrf-token=csrf-user-b',
    ]);
    for (const headers of forwardedHeaders) {
      expect(headers.authorization).toBeUndefined();
      expect(headers['x-access-token']).toBeUndefined();
      expect(headers['x-aioncore-bootstrap-secret']).toBeUndefined();
      expect(headers['x-csrf-token']).toMatch(/^csrf-user-/);
    }

    const upgrade = async (cookie: string): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const socket = netModule.connect({ host: '127.0.0.1', port: handle?.port }, () => {
          socket.write(
            'GET /ws HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${handle?.port}\r\n` +
              `Cookie: ${cookie}\r\n` +
              'Authorization: Bearer injected\r\n' +
              'X-Access-Token: injected-token\r\n' +
              'X-Aioncore-Bootstrap-Secret: injected-secret\r\n' +
              'Upgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
          );
        });
        socket.on('data', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', reject);
      });
    };
    await upgrade(cookieA);
    await upgrade(cookieB);
    expect(upgradeHeaders.map((headers) => headers.cookie)).toEqual([
      'aionui-session=access-user-a',
      'aionui-session=access-user-b',
    ]);
    for (const headers of upgradeHeaders) {
      expect(headers.authorization).toBeUndefined();
      expect(headers['x-access-token']).toBeUndefined();
      expect(headers['x-aioncore-bootstrap-secret']).toBeUndefined();
    }

    const trustedResponse = await fetch(`${handle.localUrl}/api/auth/internal/external-sessions`, {
      method: 'POST',
      headers: { cookie: cookieA, 'x-aioncore-bootstrap-secret': 'bootstrap-secret' },
    });
    expect(trustedResponse.status).toBe(404);
    expect(trustedBrowserRequests).toBe(0);

    const logoutResponse = await fetch(`${handle.localUrl}/api/lark-auth/logout`, {
      method: 'POST',
      headers: { cookie: cookieA },
    });
    expect(logoutResponse.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(revokeCookies).toEqual(['aionui-refresh-session=sid-user-a.refresh-user-a']);
    expect(trustedBootstrapHeaders).toEqual([
      'bootstrap-secret',
      'bootstrap-secret',
      'bootstrap-secret',
      'bootstrap-secret',
      'bootstrap-secret',
    ]);
    expect(
      (
        await fetch(`${handle.localUrl}/api/anything`, {
          headers: { cookie: cookieA },
        })
      ).status
    ).toBe(401);
    expect(
      (
        await fetch(`${handle.localUrl}/api/anything`, {
          headers: { cookie: cookieB },
        })
      ).status
    ).toBe(200);

    const businessDenied = await fetch(`${handle.localUrl}/api/business-denied`, {
      headers: { cookie: cookieB },
    });
    expect(businessDenied.status).toBe(401);
    expect(businessDenied.headers.get('set-cookie')).toBeNull();
    expect(
      (
        await fetch(`${handle.localUrl}/api/auth/user`, {
          headers: { cookie: cookieB },
        })
      ).status
    ).toBe(200);

    const adminRevoked = await fetch(`${handle.localUrl}/api/admin-revoked`, {
      headers: { cookie: cookieB },
    });
    expect(adminRevoked.status).toBe(401);
    expect(adminRevoked.headers.get('set-cookie')).toContain('Max-Age=0');
    const staleLocalUser = await fetch(`${handle.localUrl}/api/auth/user`, {
      headers: { cookie: cookieB },
    });
    expect(staleLocalUser.status).toBe(401);
    expect(staleLocalUser.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('/api proxy returns 502 when backend unreachable', async () => {
    // allocate a port then free it
    const placeholder = await startMockBackend((_req, res) => res.end());
    const freePort = placeholder.port;
    await placeholder.close();

    handle = await startStaticServer({ staticDir, backendPort: freePort, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/anything`);
    expect(r.status).toBe(502);
  });

  it('/ws WebSocket upgrade is spliced to backend and 101 is relayed', async () => {
    // Mock backend that accepts any WebSocket upgrade and replies with 101.
    // We don't run a real ws protocol — just verify the upgrade response makes
    // it back through the TCP-splice proxy. This is the exact regression path
    // that bun 1.3's http-compat upgrade handler broke.
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      // Send a single 0-length WS text frame as a liveness marker then close.
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    // Speak raw HTTP/1.1 upgrade over a TCP socket against the public listener.
    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /ws HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('/api/stt/stream WebSocket upgrade is spliced to backend and 101 is relayed', async () => {
    // Same as /ws test but for STT streaming endpoint.
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /api/stt/stream HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('/api/stt/stream with query params is spliced to backend', async () => {
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /api/stt/stream?lang=en&model=default HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('POST body with a large payload is fully forwarded to backend (no byte drop during splice)', async () => {
    // Regression for #4058: WebUI uploads hang forever at 100%. When the routing
    // decision fired on the first chunk, the pre-router removed its 'data'
    // listener but left the socket in flowing mode; body bytes arriving before
    // the async `client.pipe(upstream)` was wired had no consumer and were
    // silently dropped. The backend then waited forever for the missing bytes,
    // so the browser upload sat at 100% and never returned. A body large enough
    // to span multiple TCP segments reproduces the race deterministically.
    const BODY_LEN = 512 * 1024; // 512 KB — spans several TCP segments

    const backend = await startMockBackend((req, res) => {
      let received = 0;
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received }));
      });
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const { port: publicPort } = handle;
    const body = Buffer.alloc(BODY_LEN, 0x61); // 512 KB of 'a'

    const received: number = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: publicPort,
          method: 'POST',
          path: '/api/fs/upload',
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': BODY_LEN,
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            raw += c;
          });
          res.on('end', () => {
            try {
              resolve((JSON.parse(raw) as { received: number }).received);
            } catch (e) {
              reject(e as Error);
            }
          });
        }
      );
      request.on('error', reject);
      request.setTimeout(5000, () => {
        request.destroy(new Error('timeout: backend never received the full body (bytes dropped in splice)'));
      });
      request.end(body);
    });

    expect(received).toBe(BODY_LEN);
  });

  it('network URL populated only when allowRemote=true', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    const h1 = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: false,
    });
    expect(h1.networkUrl).toBeUndefined();
    await h1.stop();

    const h2 = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: true,
    });
    // may still be undefined on CI machines without a LAN interface
    expect(typeof h2.networkUrl === 'string' || h2.networkUrl === undefined).toBe(true);
    await h2.stop();
  });
});
