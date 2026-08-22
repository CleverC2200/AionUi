import { randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CoreSessionClient,
  startWebHost,
  type WebHostHandle,
  type WebHostLarkAuth,
  type WebHostLarkExternalIdentity,
} from '../../src/index.js';

const coreBinary = process.env.AIONUI_AIONCORE_BINARY?.trim() ?? '';
const realCoreAvailable = coreBinary !== '' && existsSync(coreBinary);
const platformTokenSentinel = 'issue133-platform-access-token-must-not-leak';
const delegationTokenSentinel = 'issue133-delegation-token-must-not-leak';

type JsonRecord = Record<string, unknown>;
type TracedResponse = {
  body: JsonRecord;
  cookie: string | null;
  response: Response;
  text: string;
};

const identities = {
  'qr-a': {
    provider: 'lark',
    issuer: 'https://mock-gea.invalid/gea-boot',
    tenant_id: '1001',
    subject: 'issue133-user-a',
  },
  'qr-b': {
    provider: 'lark',
    issuer: 'https://mock-gea.invalid/gea-boot',
    tenant_id: '1002',
    subject: 'issue133-user-b',
  },
} satisfies Record<string, WebHostLarkExternalIdentity>;

function createMockLarkAuth(): WebHostLarkAuth {
  return {
    createQrSession: async () => ({
      success: true,
      data: {
        expiresIn: 300,
        loginUrl: 'https://mock-gea.invalid/scan',
        qrcodeId: 'qr-a',
        accessToken: platformTokenSentinel,
      },
      delegationToken: delegationTokenSentinel,
    }),
    pollQrSession: async (qrcodeId: string) => {
      const identity = identities[qrcodeId as keyof typeof identities];
      if (!identity) return { publicResult: { success: false, code: 'invalidResponse' } };
      const user = {
        id: identity.subject,
        username: identity.subject,
        realname: identity.subject,
      };
      return {
        identity,
        publicResult: {
          success: true,
          data: {
            status: 'authenticated',
            user,
            accessToken: platformTokenSentinel,
            delegationToken: delegationTokenSentinel,
          },
        },
        accessToken: platformTokenSentinel,
      };
    },
  };
}

async function readJson(response: Response): Promise<TracedResponse> {
  const text = await response.text();
  return {
    body: JSON.parse(text) as JsonRecord,
    cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? null,
    response,
    text,
  };
}

async function openWebSocket(port: number, cookie: string): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('WebSocket handshake timed out'));
    }, 10_000);
    let response = '';
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      socket.off('error', onError);
      socket.off('data', onData);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve(socket);
      }
    };
    const onError = (error: Error) => finish(error);
    const onData = (chunk: Buffer) => {
      response += chunk.toString('latin1');
      if (!response.includes('\r\n\r\n')) return;
      const statusLine = response.split('\r\n', 1)[0];
      finish(statusLine.includes('101 Switching Protocols') ? undefined : new Error(statusLine));
    };
    socket.on('error', onError);
    socket.on('data', onData);
    socket.on('connect', () => {
      socket.write(
        'GET /ws HTTP/1.1\r\n' +
          `Host: 127.0.0.1:${port}\r\n` +
          `Cookie: ${cookie}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n\r\n`
      );
    });
  });
}

async function waitForSocketCloseFrame(socket: net.Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('revoked WebSocket did not receive a Close frame'));
    }, 10_000);
    const finish = () => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.destroy();
      resolve();
    };
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 2) {
        const opcode = buffered[0] & 0x0f;
        let headerLength = 2;
        let payloadLength = buffered[1] & 0x7f;
        if (payloadLength === 126) {
          if (buffered.length < 4) return;
          payloadLength = buffered.readUInt16BE(2);
          headerLength = 4;
        } else if (payloadLength === 127) {
          if (buffered.length < 10) return;
          const length = buffered.readBigUInt64BE(2);
          if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket frame is too large');
          payloadLength = Number(length);
          headerLength = 10;
        }
        const frameLength = headerLength + payloadLength;
        if (buffered.length < frameLength) return;
        buffered = buffered.subarray(frameLength);
        if (opcode === 0x8) {
          finish();
          return;
        }
      }
    };
    socket.on('data', onData);
  });
}

describe.skipIf(!realCoreAvailable)('renewable Lark-to-Core session with a real AionCore process', () => {
  let rootDir = '';
  let staticDir = '';
  let host: WebHostHandle | null = null;
  let bootstrapSecret = '';
  const browserEvidence: string[] = [];

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-issue133-core-'));
    staticDir = path.join(rootDir, 'renderer');
    await fs.mkdir(staticDir, { recursive: true });
    await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>issue-133</title>');
    bootstrapSecret = randomBytes(32).toString('base64url');
  });

  afterAll(async () => {
    await host?.stop().catch(() => {});
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const start = async (): Promise<WebHostHandle> =>
    startWebHost({
      app: {
        version: 'issue-133-e2e',
        isPackaged: false,
        resourcesPath: rootDir,
        userDataPath: rootDir,
      },
      staticDir,
      dataDir: path.join(rootDir, 'data'),
      logDir: path.join(rootDir, 'logs'),
      dirs: {
        cacheDir: path.join(rootDir, 'cache'),
        workDir: path.join(rootDir, 'work'),
        logDir: path.join(rootDir, 'logs'),
      },
      backend: { kind: 'ownBackend', resolveBackend: () => coreBinary },
      larkAuth: createMockLarkAuth(),
      coreSessionBootstrapSecret: bootstrapSecret,
      port: 0,
    });

  const request = async (url: string, init?: RequestInit): Promise<TracedResponse> => {
    const traced = await readJson(await fetch(url, init));
    browserEvidence.push(
      JSON.stringify({
        status: traced.response.status,
        body: traced.body,
        setCookie: traced.response.headers.get('set-cookie'),
      })
    );
    return traced;
  };

  const login = async (qrcodeId: keyof typeof identities): Promise<string> => {
    const traced = await request(`${host?.localUrl}/api/lark-auth/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qrcodeId }),
    });
    expect(traced.response.status).toBe(200);
    expect(traced.cookie).toMatch(/^aionui-web-session=/);
    return traced.cookie ?? '';
  };

  it('isolates two identities and data, rotates refresh, revokes HTTP/WS, and fails old cookies across restart', async () => {
    host = await start();
    const cookieA = await login('qr-a');
    const cookieB = await login('qr-b');

    const currentUser = async (cookie: string) =>
      request(`${host?.localUrl}/api/system/current-user`, { headers: { cookie } });
    const userA = await currentUser(cookieA);
    const userB = await currentUser(cookieB);
    const coreUserIdA = ((userA.body.data as JsonRecord).id as string) ?? '';
    const coreUserIdB = ((userB.body.data as JsonRecord).id as string) ?? '';
    expect(coreUserIdA).not.toBe('');
    expect(coreUserIdB).not.toBe('');
    expect(coreUserIdA).not.toBe(coreUserIdB);

    const putPreference = (cookie: string, value: string) =>
      request(`${host?.localUrl}/api/settings/client`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ issue133_identity_marker: value }),
      });
    await putPreference(cookieA, 'alpha-only');
    await putPreference(cookieB, 'beta-only');
    const preferencesA = await request(`${host.localUrl}/api/settings/client?keys=issue133_identity_marker`, {
      headers: { cookie: cookieA },
    });
    const preferencesB = await request(`${host.localUrl}/api/settings/client?keys=issue133_identity_marker`, {
      headers: { cookie: cookieB },
    });
    expect((preferencesA.body.data as JsonRecord).issue133_identity_marker).toBe('alpha-only');
    expect((preferencesB.body.data as JsonRecord).issue133_identity_marker).toBe('beta-only');

    const trustedClient = new CoreSessionClient(host.backendPort, bootstrapSecret);
    const directSession = await trustedClient.exchange(identities['qr-a']);
    const refreshed = await trustedClient.refresh(directSession.refreshCookie, randomBytes(32).toString('base64url'));
    expect(refreshed.session.sid).toBe(directSession.session.sid);
    expect(refreshed.session.rotation).toBe(directSession.session.rotation + 1);
    expect(refreshed.accessCookie).not.toBe(directSession.accessCookie);
    expect(refreshed.refreshCookie).not.toBe(directSession.refreshCookie);
    await trustedClient.revokeMatching(refreshed.refreshCookie);

    const socketA = await openWebSocket(host.port, cookieA);
    const socketClosed = waitForSocketCloseFrame(socketA);
    const logoutA = await request(`${host.localUrl}/api/lark-auth/logout`, {
      method: 'POST',
      headers: { cookie: cookieA },
    });
    expect(logoutA.response.status).toBe(200);
    expect(logoutA.response.headers.get('set-cookie')).toContain('Max-Age=0');
    await socketClosed;
    expect((await currentUser(cookieA)).response.status).toBe(401);
    expect((await currentUser(cookieB)).response.status).toBe(200);

    await trustedClient.revoke(identities['qr-b']);
    const revokedB = await currentUser(cookieB);
    expect(revokedB.response.status).toBe(401);
    expect(revokedB.response.headers.get('set-cookie')).toContain('Max-Age=0');

    await host.stop();
    host = await start();
    const staleAfterRestart = await currentUser(cookieA);
    expect(staleAfterRestart.response.status).toBe(401);
    expect(staleAfterRestart.response.headers.get('set-cookie')).toContain('Max-Age=0');

    const restartedCookieA = await login('qr-a');
    const restartedUserA = await currentUser(restartedCookieA);
    expect((restartedUserA.body.data as JsonRecord).id).toBe(coreUserIdA);
    const persistedPreferenceA = await request(`${host.localUrl}/api/settings/client?keys=issue133_identity_marker`, {
      headers: { cookie: restartedCookieA },
    });
    expect((persistedPreferenceA.body.data as JsonRecord).issue133_identity_marker).toBe('alpha-only');

    const browserSurface = browserEvidence.join('\n');
    expect(browserSurface).not.toContain(platformTokenSentinel);
    expect(browserSurface).not.toContain(delegationTokenSentinel);
    expect(browserSurface).not.toContain(bootstrapSecret);
    expect(browserSurface).not.toMatch(/aionui-(?:refresh-)?session=/);
  }, 120_000);

  it.runIf(process.env.ISSUE133_LONG_RUNTIME === '1')(
    'keeps the same opaque WebHost session healthy for 24 wall-clock hours',
    async () => {
      host = await start();
      const cookie = await login('qr-a');
      const deadline = Date.now() + 24 * 60 * 60 * 1000;
      while (Date.now() < deadline) {
        // This is a wall-clock soak: probes and delays must remain ordered.
        // eslint-disable-next-line no-await-in-loop
        const status = await request(`${host.localUrl}/api/lark-auth/status`, { headers: { cookie } });
        expect(status.response.status).toBe(200);
        expect((status.body.data as JsonRecord).authenticated).toBe(true);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, Math.min(5 * 60 * 1000, deadline - Date.now())));
      }
    },
    24 * 60 * 60 * 1000 + 120_000
  );
});
