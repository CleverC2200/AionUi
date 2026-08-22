import { randomBytes } from 'node:crypto';
import type { WebHostLarkExternalIdentity } from './types.js';

const BOOTSTRAP_SECRET_ENV = 'AIONCORE_BOOTSTRAP_SECRET';
const BOOTSTRAP_SECRET_HEADER = 'x-aioncore-bootstrap-secret';
const CORE_SESSION_COOKIE = 'aionui-session';
const PROVISION_PATH = '/api/auth/internal/external-identities';
const EXCHANGE_PATH = '/api/auth/internal/external-sessions';
const REVOKE_PATH = '/api/auth/internal/external-sessions/revoke';

type JsonRecord = Record<string, unknown>;

export type CoreExternalIdentity = WebHostLarkExternalIdentity;

export type CoreSession = {
  cookie: string;
  sessionGeneration: number;
  user: { id: string; username: string };
};

export type CoreExternalIdentityMapping = {
  coreUserId: string;
  created: boolean;
};

export type CoreSessionRevocation = {
  sessionGeneration: number;
  userId: string;
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
    const response = await this.request(PROVISION_PATH, 'PUT', identity);
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
    const response = await this.request(EXCHANGE_PATH, 'POST', identity);
    const body = await readJsonRecord(response);
    const data = asRecord(body.data);
    const user = asRecord(data?.user);
    const id = asNonEmptyString(user?.id);
    const username = asNonEmptyString(user?.username);
    const sessionGeneration = asInteger(data?.session_generation);
    const cookie = extractCoreSessionCookie(response.headers.get('set-cookie'));
    if (body.success !== true || !id || !username || sessionGeneration === null || !cookie) {
      throw new CoreSessionClientError('CORE_SESSION_RESPONSE_INVALID', 502);
    }
    return { cookie, sessionGeneration, user: { id, username } };
  }

  async revoke(identity: CoreExternalIdentity): Promise<CoreSessionRevocation> {
    const response = await this.request(REVOKE_PATH, 'POST', identity);
    const body = await readJsonRecord(response);
    const data = asRecord(body.data);
    const userId = asNonEmptyString(data?.user_id);
    const sessionGeneration = asInteger(data?.session_generation);
    if (body.success !== true || !userId || sessionGeneration === null) {
      throw new CoreSessionClientError('CORE_SESSION_RESPONSE_INVALID', 502);
    }
    return { userId, sessionGeneration };
  }

  private async request(path: string, method: 'POST' | 'PUT', identity: CoreExternalIdentity): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`http://127.0.0.1:${this.backendPort}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          [BOOTSTRAP_SECRET_HEADER]: this.bootstrapSecret,
        },
        body: JSON.stringify({ identity }),
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

function extractCoreSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = new RegExp(`(?:^|,\\s*)(${CORE_SESSION_COOKIE}=[^;,\\s]+)(?:;|,|$)`).exec(setCookie);
  return match?.[1] ?? null;
}
