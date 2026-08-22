import { randomBytes } from 'node:crypto';
import type { WebHostLarkExternalIdentity } from './types.js';

const BOOTSTRAP_SECRET_ENV = 'AIONCORE_BOOTSTRAP_SECRET';
const BOOTSTRAP_SECRET_HEADER = 'x-aioncore-bootstrap-secret';
const CORE_SESSION_COOKIE = 'aionui-session';
const CORE_REFRESH_SESSION_COOKIE = 'aionui-refresh-session';
const CORE_CSRF_COOKIE = 'aionui-csrf-token';
const PROVISION_PATH = '/api/auth/internal/external-identities';
const EXCHANGE_PATH = '/api/auth/internal/external-sessions';
const REVOKE_PATH = '/api/auth/internal/external-sessions/revoke';
const REFRESH_PATH = '/api/auth/internal/external-sessions/refresh';
const REVOKE_MATCHING_PATH = '/api/auth/internal/external-sessions/revoke-matching';
const REFRESH_IDEMPOTENCY_HEADER = 'x-aioncore-refresh-idempotency-key';
const CORE_SESSION_REQUEST_TIMEOUT_MS = 10_000;

type JsonRecord = Record<string, unknown>;

export type CoreExternalIdentity = WebHostLarkExternalIdentity;

export type CoreSession = {
  accessCookie: string;
  csrfCookie: string;
  refreshCookie: string;
  sessionGeneration: number;
  session: CoreSessionMetadata;
  user: { id: string; username: string };
};

export type CoreSessionMetadata = {
  accessExpiresAt: number;
  refreshExpiresAt: number;
  rotation: number;
  sid: string;
};

export type CoreSessionRefresh = {
  accessCookie: string;
  csrfCookie: string;
  refreshCookie: string;
  session: CoreSessionMetadata;
};

export type CoreExternalIdentityMapping = {
  coreUserId: string;
  created: boolean;
};

export type CoreSessionRevocation = {
  sessionGeneration: number;
  userId: string;
};

export type CoreMatchingSessionRevocation = {
  revoked: true;
  sid: string;
};

export class CoreSessionClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = 'CoreSessionClientError';
  }
}

let heldBootstrapSecret: string | undefined;

/**
 * Move the trusted bootstrap secret out of the ambient process environment.
 * The returned value must stay in the host process and be injected only into
 * the direct aioncore child plus trusted loopback requests.
 */
export function getCoreSessionBootstrapSecret(): string {
  if (heldBootstrapSecret) return heldBootstrapSecret;
  const configured = process.env[BOOTSTRAP_SECRET_ENV];
  delete process.env[BOOTSTRAP_SECRET_ENV];
  heldBootstrapSecret = configured || randomBytes(32).toString('base64url');
  return heldBootstrapSecret;
}

export class CoreSessionClient {
  constructor(
    private readonly backendPort: number,
    private readonly bootstrapSecret: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async ensureMapping(identity: CoreExternalIdentity): Promise<CoreExternalIdentityMapping> {
    const response = await this.requestWithIdentity(PROVISION_PATH, 'PUT', identity);
    const body = await readJsonRecord(response);
    const data = asRecord(body.data);
    const coreUserId = asNonEmptyString(data?.core_user_id);
    const created = data?.created;
    if (body.success !== true || !coreUserId || typeof created !== 'boolean') {
      throw new CoreSessionClientError('CORE_SESSION_RESPONSE_INVALID', 502);
    }
    return { coreUserId, created };
  }

  async exchange(identity: CoreExternalIdentity): Promise<CoreSession> {
    const response = await this.requestWithIdentity(EXCHANGE_PATH, 'POST', identity);
    const body = await readJsonRecord(response);
    const data = asRecord(body.data);
    const user = asRecord(data?.user);
    const id = asNonEmptyString(user?.id);
    const username = asNonEmptyString(user?.username);
    const sessionGeneration = asInteger(data?.session_generation);
    const session = parseSessionMetadata(data?.session);
    const accessCookie = extractCoreSessionCookie(response.headers, CORE_SESSION_COOKIE);
    const refreshCookie = extractCoreSessionCookie(response.headers, CORE_REFRESH_SESSION_COOKIE);
    const csrfCookie = extractCoreSessionCookie(response.headers, CORE_CSRF_COOKIE);
    if (
      body.success !== true ||
      !id ||
      !username ||
      sessionGeneration === null ||
      !session ||
      !accessCookie ||
      !refreshCookie ||
      !csrfCookie ||
      !refreshCookieMatchesSid(refreshCookie, session.sid)
    ) {
      throw new CoreSessionClientError('CORE_SESSION_RESPONSE_INVALID', 502);
    }
    return { accessCookie, csrfCookie, refreshCookie, sessionGeneration, session, user: { id, username } };
  }

  async refresh(refreshCookie: string, idempotencyKey: string): Promise<CoreSessionRefresh> {
    const response = await this.requestWithCookie(REFRESH_PATH, refreshCookie, idempotencyKey);
    const body = await readJsonRecord(response);
    const data = asRecord(body.data);
    const session = parseSessionMetadata(data?.session);
    const accessCookie = extractCoreSessionCookie(response.headers, CORE_SESSION_COOKIE);
    const nextRefreshCookie = extractCoreSessionCookie(response.headers, CORE_REFRESH_SESSION_COOKIE);
    const csrfCookie = extractCoreSessionCookie(response.headers, CORE_CSRF_COOKIE);
    if (
      body.success !== true ||
      !session ||
      !accessCookie ||
      !nextRefreshCookie ||
      !csrfCookie ||
      !refreshCookieMatchesSid(nextRefreshCookie, session.sid)
    ) {
      throw new CoreSessionClientError('CORE_SESSION_RESPONSE_INVALID', 502);
    }
    return { accessCookie, csrfCookie, refreshCookie: nextRefreshCookie, session };
  }

  async revoke(identity: CoreExternalIdentity): Promise<CoreSessionRevocation> {
    const response = await this.requestWithIdentity(REVOKE_PATH, 'POST', identity);
    const body = await readJsonRecord(response);
    const data = asRecord(body.data);
    const userId = asNonEmptyString(data?.user_id);
    const sessionGeneration = asInteger(data?.session_generation);
    if (body.success !== true || !userId || sessionGeneration === null) {
      throw new CoreSessionClientError('CORE_SESSION_RESPONSE_INVALID', 502);
    }
    return { userId, sessionGeneration };
  }

  async revokeMatching(refreshCookie: string): Promise<CoreMatchingSessionRevocation> {
    const response = await this.requestWithCookie(REVOKE_MATCHING_PATH, refreshCookie);
    const body = await readJsonRecord(response);
    const data = asRecord(body.data);
    const sid = asNonEmptyString(data?.sid);
    if (body.success !== true || !sid || data?.revoked !== true) {
      throw new CoreSessionClientError('CORE_SESSION_RESPONSE_INVALID', 502);
    }
    return { sid, revoked: true };
  }

  private requestWithIdentity(path: string, method: 'POST' | 'PUT', identity: CoreExternalIdentity): Promise<Response> {
    return this.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity }),
    });
  }

  private requestWithCookie(path: string, refreshCookie: string, idempotencyKey?: string): Promise<Response> {
    if (!/^aionui-refresh-session=[^;,\s]+$/.test(refreshCookie) || (idempotencyKey && !isRefreshKey(idempotencyKey))) {
      throw new CoreSessionClientError('CORE_SESSION_REQUEST_INVALID', 500);
    }
    return this.request(path, {
      method: 'POST',
      headers: {
        cookie: refreshCookie,
        ...(idempotencyKey ? { [REFRESH_IDEMPOTENCY_HEADER]: idempotencyKey } : {}),
      },
    });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`http://127.0.0.1:${this.backendPort}${path}`, {
        ...init,
        signal: AbortSignal.timeout(CORE_SESSION_REQUEST_TIMEOUT_MS),
        headers: {
          ...init.headers,
          [BOOTSTRAP_SECRET_HEADER]: this.bootstrapSecret,
        },
      });
    } catch {
      throw new CoreSessionClientError('CORE_SESSION_UNAVAILABLE', 502);
    }
    if (!response.ok) {
      throw new CoreSessionClientError(await readStableErrorCode(response), response.status);
    }
    return response;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() === value && value !== '' ? value : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function parseSessionMetadata(value: unknown): CoreSessionMetadata | null {
  const session = asRecord(value);
  const sid = asNonEmptyString(session?.sid);
  const rotation = asInteger(session?.rotation);
  const accessExpiresAtSeconds = asInteger(session?.access_expires_at);
  const refreshExpiresAtSeconds = asInteger(session?.refresh_expires_at);
  if (
    !sid ||
    rotation === null ||
    rotation < 0 ||
    accessExpiresAtSeconds === null ||
    accessExpiresAtSeconds <= 0 ||
    refreshExpiresAtSeconds === null ||
    refreshExpiresAtSeconds <= accessExpiresAtSeconds ||
    refreshExpiresAtSeconds > Number.MAX_SAFE_INTEGER / 1000
  ) {
    return null;
  }
  return {
    sid,
    rotation,
    accessExpiresAt: accessExpiresAtSeconds * 1000,
    refreshExpiresAt: refreshExpiresAtSeconds * 1000,
  };
}

async function readJsonRecord(response: Response): Promise<JsonRecord> {
  try {
    return asRecord(await response.json()) ?? {};
  } catch {
    return {};
  }
}

async function readStableErrorCode(response: Response): Promise<string> {
  const body = await readJsonRecord(response);
  const code = typeof body.code === 'string' ? body.code : '';
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : `CORE_SESSION_HTTP_${response.status}`;
}

function extractCoreSessionCookie(headers: Headers, name: string): string | null {
  const headersWithSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = headersWithSetCookie.getSetCookie?.() ?? [headers.get('set-cookie') ?? ''];
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|,\\s*)(${escapedName}=[^;,\\s]+)(?:;|,|$)`);
  for (const value of values) {
    const match = pattern.exec(value);
    if (match?.[1]) return match[1];
  }
  return null;
}

function refreshCookieMatchesSid(cookie: string, sid: string): boolean {
  return cookie.startsWith(`${CORE_REFRESH_SESSION_COOKIE}=${sid}.`);
}

function isRefreshKey(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
}
