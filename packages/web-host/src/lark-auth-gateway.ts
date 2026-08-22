import { randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { CoreSessionClient, getCoreSessionBootstrapSecret } from './core-session-client.js';
import type {
  WebHostLarkAuth,
  WebHostLarkAuthResult,
  WebHostLarkAuthUser,
  WebHostLarkExternalIdentity,
  WebHostLarkQrLoginPollResult,
  WebHostLarkQrLoginSession,
} from './types.js';

const WEB_SESSION_COOKIE = 'aionui-web-session';
const WEB_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const MAX_JSON_BODY_BYTES = 16 * 1024;

type WebSession = {
  coreSessionCookie: string;
  expiresAt: number;
  identity: WebHostLarkExternalIdentity;
  user: WebHostLarkAuthUser;
};

function writeJson(res: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function cookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

export class LarkAuthGateway {
  private readonly sessions = new Map<string, WebSession>();

  private constructor(
    private readonly larkAuth: WebHostLarkAuth,
    private readonly coreSessions: CoreSessionClient
  ) {}

  static create(backendPort: number, larkAuth: WebHostLarkAuth, bootstrapSecret?: string): LarkAuthGateway {
    const heldBootstrapSecret = getCoreSessionBootstrapSecret();
    return new LarkAuthGateway(larkAuth, new CoreSessionClient(backendPort, bootstrapSecret ?? heldBootstrapSecret));
  }

  getBackendHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
    const session = this.getSession(headers.cookie);
    const {
      cookie: _cookie,
      host: _host,
      authorization: _authorization,
      'x-access-token': _accessToken,
      'x-aioncore-bootstrap-secret': _bootstrapSecret,
      ...forwardedHeaders
    } = headers;
    return { ...forwardedHeaders, ...(session ? { cookie: session.coreSessionCookie } : {}) };
  }

  isAuthenticated(cookieHeader: string | undefined): boolean {
    return this.getSession(cookieHeader) !== null;
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url?.split('?', 1)[0];

    if (url === '/api/lark-auth/qr-session' && req.method === 'POST') {
      writeJson(res, 200, sanitizeQrSessionResult(await this.larkAuth.createQrSession()));
      return true;
    }

    if (url === '/api/lark-auth/poll' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const qrcodeId = typeof body.qrcodeId === 'string' ? body.qrcodeId.trim() : '';
        if (!qrcodeId) {
          writeJson(res, 400, { success: false, code: 'invalidResponse' });
          return true;
        }
        const poll = await this.larkAuth.pollQrSession(qrcodeId);
        const result = sanitizePollResult(poll.publicResult);
        if (result.success && result.data.status === 'authenticated' && result.data.user) {
          const identity = sanitizeExternalIdentity(poll.identity);
          if (!identity) {
            writeJson(res, 502, { success: false, code: 'serverError' });
            return true;
          }
          await this.coreSessions.ensureMapping(identity);
          const coreSession = await this.coreSessions.exchange(identity);
          const token = randomBytes(32).toString('base64url');
          this.sessions.set(token, {
            coreSessionCookie: coreSession.cookie,
            expiresAt: Date.now() + WEB_SESSION_MAX_AGE_SECONDS * 1000,
            identity,
            user: result.data.user,
          });
          writeJson(res, 200, result, {
            'set-cookie': `${WEB_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${WEB_SESSION_MAX_AGE_SECONDS}`,
          });
          return true;
        }
        writeJson(res, 200, result);
      } catch {
        writeJson(res, 502, { success: false, code: 'serverError' });
      }
      return true;
    }

    if (url === '/api/lark-auth/status' && req.method === 'GET') {
      const session = this.getSession(req.headers.cookie);
      writeJson(
        res,
        200,
        session
          ? { success: true, data: { authenticated: true, user: session.user } }
          : { success: true, data: { authenticated: false } }
      );
      return true;
    }

    if (url === '/api/auth/user' && req.method === 'GET') {
      const session = this.getSession(req.headers.cookie);
      if (!session) {
        writeJson(res, 401, { success: false });
      } else {
        writeJson(res, 200, { success: true, user: session.user });
      }
      return true;
    }

    if ((url === '/api/lark-auth/logout' || url === '/logout') && req.method === 'POST') {
      const token = cookieValue(req.headers.cookie, WEB_SESSION_COOKIE);
      const session = token ? this.sessions.get(token) : undefined;
      if (token) this.sessions.delete(token);
      let statusCode = 200;
      let responseBody: unknown = { success: true, data: { authenticated: false } };
      if (session) {
        try {
          await this.coreSessions.revoke(session.identity);
        } catch {
          statusCode = 502;
          responseBody = { success: false, code: 'serverError' };
        }
      }
      writeJson(res, statusCode, responseBody, {
        'set-cookie': `${WEB_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      });
      return true;
    }

    if (url === '/login') {
      writeJson(res, 404, { success: false, error: 'PASSWORD_LOGIN_DISABLED' });
      return true;
    }

    return false;
  }

  authorizeUpgrade(requestBytes: Buffer): Buffer | null {
    const headerEnd = requestBytes.indexOf('\r\n\r\n');
    if (headerEnd < 0) return null;
    const headerText = requestBytes.subarray(0, headerEnd).toString('latin1');
    const lines = headerText.split('\r\n');
    const cookieHeader = lines
      .find((line) => /^cookie:/i.test(line))
      ?.slice('cookie:'.length)
      .trim();
    const session = this.getSession(cookieHeader);
    if (!session) return null;

    const nextLines = lines.filter(
      (line) => !/^(?:cookie|authorization|x-access-token|x-aioncore-bootstrap-secret):/i.test(line)
    );
    nextLines.push(`Cookie: ${session.coreSessionCookie}`);
    const nextHeader = Buffer.from(`${nextLines.join('\r\n')}\r\n\r\n`, 'latin1');
    return Buffer.concat([nextHeader, requestBytes.subarray(headerEnd + 4)]);
  }

  isTrustedRoute(url: string): boolean {
    return url.split('?', 1)[0].startsWith('/api/auth/internal/');
  }

  private getSession(cookieHeader: string | undefined): WebSession | null {
    const token = cookieValue(cookieHeader, WEB_SESSION_COOKIE);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }
}

function sanitizeUser(user: WebHostLarkAuthUser): WebHostLarkAuthUser {
  return {
    id: user.id,
    username: user.username,
    realname: user.realname,
    ...(user.avatar ? { avatar: user.avatar } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...(user.phone ? { phone: user.phone } : {}),
  };
}

function sanitizeQrSessionResult(
  result: WebHostLarkAuthResult<WebHostLarkQrLoginSession>
): WebHostLarkAuthResult<WebHostLarkQrLoginSession> {
  if (result.success === false) return { success: false, code: result.code };
  return {
    success: true,
    data: {
      expiresIn: result.data.expiresIn,
      loginUrl: result.data.loginUrl,
      qrcodeId: result.data.qrcodeId,
    },
  };
}

function sanitizePollResult(
  result: WebHostLarkAuthResult<WebHostLarkQrLoginPollResult>
): WebHostLarkAuthResult<WebHostLarkQrLoginPollResult> {
  if (result.success === false) return { success: false, code: result.code };
  const data = result.data;
  return {
    success: true,
    data: {
      status: data.status,
      ...(data.user ? { user: sanitizeUser(data.user) } : {}),
      ...(data.personalModelSync
        ? {
            personalModelSync: {
              configured: data.personalModelSync.configured,
              failed: data.personalModelSync.failed,
              skipped: data.personalModelSync.skipped,
              status: data.personalModelSync.status,
            },
          }
        : {}),
    },
  };
}

function sanitizeExternalIdentity(
  identity: WebHostLarkExternalIdentity | undefined
): WebHostLarkExternalIdentity | null {
  if (
    !identity ||
    identity.provider !== 'lark' ||
    identity.issuer.trim() !== identity.issuer ||
    identity.issuer === '' ||
    identity.tenant_id.trim() !== identity.tenant_id ||
    identity.tenant_id === '' ||
    identity.subject.trim() !== identity.subject ||
    identity.subject === ''
  ) {
    return null;
  }
  return {
    provider: 'lark',
    issuer: identity.issuer,
    tenant_id: identity.tenant_id,
    subject: identity.subject,
  };
}
