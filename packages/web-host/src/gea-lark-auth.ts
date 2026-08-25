import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ContentBlock, Resource, ResourceContents, ResourceTemplate } from '@modelcontextprotocol/sdk/types.js';
import type {
  WebHostLarkAuth,
  WebHostLarkAuthPoll,
  WebHostLarkAuthResult,
  WebHostLarkAuthUser,
  WebHostLarkExternalIdentity,
  WebHostLarkQrLoginPollResult,
  WebHostLarkQrLoginSession,
} from './types.js';

export const DEFAULT_GEA_BASE_URL = 'https://gea.synear.cn:4443/gea-boot';
const DEFAULT_GEA_TENANT_ID = '0';
const QR_CODE_EXPIRES_IN_SECONDS = 300;
const SESSION_RESTORE_ATTEMPTS = 2;
const SESSION_RESTORE_RETRY_DELAY_MS = 100;
const SESSION_RESTORE_TIMEOUT_MS = 2_500;
const PERSONAL_CREDENTIAL_PAGE_SIZE = 100;

type FetchLike = typeof fetch;
type LarkAuthErrorCode = 'invalidResponse' | 'networkError' | 'serverError';

export type GeaLarkAuthSession = {
  accessToken: string;
};

export type GeaGatewayAuthSession = {
  accessToken: string;
  tenantId: string;
};

export type GeaVerifiedLarkQrLogin = {
  identity?: WebHostLarkExternalIdentity;
  result: WebHostLarkQrLoginPollResult;
};

export type GeaLarkAuthSessionStore = {
  clear: () => Promise<void>;
  load: () => Promise<GeaLarkAuthSession | null>;
  save: (session: GeaLarkAuthSession) => Promise<void>;
};

type GeaResponse<T> = {
  code?: string | number;
  message?: string;
  success?: boolean;
  result?: T;
};

type GeaGatewaySessionResponse = {
  accessDecision?: {
    allowed?: boolean;
    code?: string;
  };
  delegationToken?: string;
  gatewayContext?: {
    agentId?: string;
    consumerCode?: string;
    conversationId?: string;
    sessionId?: string;
  };
};

type GeaGatewayToolResponse = {
  description?: unknown;
  inputSchema?: unknown;
  mcpCode?: unknown;
  _meta?: Record<string, unknown>;
  name?: unknown;
  sourceCode?: unknown;
};

export type GeaMcpGatewayTool = {
  description?: string;
  inputSchema: Record<string, unknown>;
  name: string;
  sourceCode: string;
};

export type GeaMcpGatewayCallResult = {
  auditId?: string;
  content?: ContentBlock[];
  isError?: boolean;
  result?: unknown;
};

export type GeaMcpGatewaySession = {
  callTool: (tool: GeaMcpGatewayTool, argumentsValue?: Record<string, unknown>) => Promise<GeaMcpGatewayCallResult>;
  close: () => Promise<void>;
  listResourceTemplates: (cursor?: string) => Promise<{ nextCursor?: string; resourceTemplates: ResourceTemplate[] }>;
  listResources: (cursor?: string) => Promise<{ nextCursor?: string; resources: Resource[] }>;
  listTools: () => Promise<GeaMcpGatewayTool[]>;
  readResource: (uri: string) => Promise<ResourceContents[]>;
};

type QrCodeResponse = {
  qrcodeId?: string;
};

type QrTokenResponse = {
  success?: boolean;
  token?: string;
};

type UserInfoResponse = {
  userInfo?: {
    avatar?: unknown;
    email?: unknown;
    id?: unknown;
    loginTenantId?: unknown;
    phone?: unknown;
    realname?: unknown;
    tenantId?: unknown;
    username?: unknown;
  };
};

export type GeaPersonalModelCredentialStatus =
  | 'PENDING_CLAIM'
  | 'ENABLED'
  | 'ROTATION_PENDING'
  | 'DISABLED'
  | 'REVOKED';

export type GeaPersonalModelCredential = {
  accessKeyId: string;
  agentCode: string;
  credentialId: string;
  status: GeaPersonalModelCredentialStatus;
  tenantId: string;
};

export type GeaClaimedPersonalModelCredential = Omit<GeaPersonalModelCredential, 'tenantId'> & {
  baseUrl: string;
  secret: string;
};

type PersonalCredentialListResponse = {
  records?: unknown;
  total?: unknown;
};

type PersonalCredentialClaimResponse = {
  accessKeyId?: unknown;
  agentCode?: unknown;
  baseUrl?: unknown;
  credentialId?: unknown;
  secret?: unknown;
  status?: unknown;
};

type OpenAiModelsResponse = {
  data?: unknown;
};

export class GeaLarkAuthServiceError extends Error {
  readonly code: LarkAuthErrorCode;
  readonly httpStatus?: number;

  constructor(code: LarkAuthErrorCode, httpStatus?: number) {
    super(code);
    this.name = 'LarkAuthServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class GeaMcpGatewayError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'GeaMcpGatewayError';
    this.code = code;
  }
}

export class GeaPersonalModelError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'GeaPersonalModelError';
    this.code = code;
  }
}

export function normalizeGeaBaseUrl(value: string, options: { allowLoopbackHttp?: boolean } = {}): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) throw new TypeError('GEA_BASE_URL_INVALID');

  const url = new URL(trimmed);
  const isLoopbackHttp =
    options.allowLoopbackHttp === true &&
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !isLoopbackHttp) throw new TypeError('GEA_BASE_URL_INSECURE');
  if (url.username || url.password || url.search || url.hash || !url.hostname) {
    throw new TypeError('GEA_BASE_URL_INVALID');
  }
  return url.toString().replace(/\/+$/, '');
}

export function createGeaEnvironmentId(baseUrl: string): string {
  return createHash('sha256').update(baseUrl).digest('hex');
}

function resolveAvatarUrl(baseUrl: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${baseUrl}/${trimmed.replace(/^\/+/, '')}`;
}

async function readJson<T>(response: Response): Promise<GeaResponse<T>> {
  if (!response.ok) {
    throw new GeaLarkAuthServiceError('serverError', response.status);
  }
  try {
    return (await response.json()) as GeaResponse<T>;
  } catch {
    throw new GeaLarkAuthServiceError('invalidResponse');
  }
}

export class GeaLarkAuthService {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private sessionStore: GeaLarkAuthSessionStore | null;
  private accessToken: string | null = null;
  private authGeneration = 0;
  private currentTenantId = DEFAULT_GEA_TENANT_ID;
  private currentUser: WebHostLarkAuthUser | null = null;

  constructor(
    options: {
      allowLoopbackHttp?: boolean;
      baseUrl?: string;
      fetchImpl?: FetchLike;
      sessionStore?: GeaLarkAuthSessionStore;
    } = {}
  ) {
    this.baseUrl = normalizeGeaBaseUrl(
      options.baseUrl ?? process.env.AIONUI_GEA_BASE_URL ?? process.env.AUTH_BROKER_PUBLIC_URL ?? DEFAULT_GEA_BASE_URL,
      { allowLoopbackHttp: options.allowLoopbackHttp }
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sessionStore = options.sessionStore ?? null;
  }

  async initializeSession(sessionStore?: GeaLarkAuthSessionStore): Promise<void> {
    if (sessionStore) this.sessionStore = sessionStore;
    const store = this.sessionStore;
    if (!store) return;

    let session: GeaLarkAuthSession | null;
    try {
      session = await store.load();
    } catch {
      return;
    }
    if (!session) return;

    await this.restoreSession(session, store, SESSION_RESTORE_ATTEMPTS);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async createQrSession(): Promise<WebHostLarkQrLoginSession> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/sys/getLoginQrcode`, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
      });
    } catch {
      throw new GeaLarkAuthServiceError('networkError');
    }

    const payload = await readJson<QrCodeResponse>(response);
    const qrcodeId = payload.success === true ? payload.result?.qrcodeId?.trim() : '';
    if (!qrcodeId) {
      throw new GeaLarkAuthServiceError('invalidResponse');
    }

    const state = `gea-client://scan-login?feishuScanQrcodeId=${encodeURIComponent(qrcodeId)}`;
    const loginUrl = new URL(`${this.baseUrl}/sys/thirdLogin/sso/lark/login`);
    loginUrl.searchParams.set('state', state);
    loginUrl.searchParams.set('tenantId', '0');
    return { expiresIn: QR_CODE_EXPIRES_IN_SECONDS, loginUrl: loginUrl.toString(), qrcodeId };
  }

  async pollQrSession(qrcodeId: string): Promise<WebHostLarkQrLoginPollResult> {
    return (await this.pollQrSessionInternal(qrcodeId, false)).result;
  }

  async pollQrSessionWithIdentity(qrcodeId: string): Promise<GeaVerifiedLarkQrLogin> {
    return this.pollQrSessionInternal(qrcodeId, true);
  }

  private async pollQrSessionInternal(
    qrcodeId: string,
    requireVerifiedTenant: boolean
  ): Promise<GeaVerifiedLarkQrLogin> {
    if (!qrcodeId.trim()) {
      throw new GeaLarkAuthServiceError('invalidResponse');
    }

    const url = new URL(`${this.baseUrl}/sys/getQrcodeToken`);
    url.searchParams.set('qrcodeId', qrcodeId);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error' });
    } catch {
      throw new GeaLarkAuthServiceError('networkError');
    }

    const payload = await readJson<QrTokenResponse>(response);
    const result = payload.result;
    const token = result?.token;
    if (payload.success !== true || typeof token !== 'string') {
      throw new GeaLarkAuthServiceError('invalidResponse');
    }
    if (token === '-1') return { result: { status: 'pending' } };
    if (token === '-2') return { result: { status: 'expired' } };
    if (result?.success !== true || token.trim() === '') {
      throw new GeaLarkAuthServiceError('invalidResponse');
    }

    const { tenantId, user } = await this.fetchCurrentUser(token);
    if (requireVerifiedTenant && tenantId === undefined) {
      throw new GeaLarkAuthServiceError('invalidResponse');
    }
    const acceptedTenantId = tenantId ?? DEFAULT_GEA_TENANT_ID;
    await this.sessionStore?.save({ accessToken: token });
    this.acceptAuthenticatedSession(token, acceptedTenantId, user);
    return {
      ...(requireVerifiedTenant
        ? { identity: buildLarkExternalIdentity(this.baseUrl, acceptedTenantId, user.id) }
        : {}),
      result: { status: 'authenticated', user },
    };
  }

  getStatus(): { authenticated: boolean; user?: WebHostLarkAuthUser } {
    return this.accessToken && this.currentUser
      ? { authenticated: true, user: this.currentUser }
      : { authenticated: false };
  }

  async logout(): Promise<void> {
    await this.sessionStore?.clear();
    this.accessToken = null;
    this.authGeneration += 1;
    this.currentTenantId = DEFAULT_GEA_TENANT_ID;
    this.currentUser = null;
  }

  /**
   * Hands the current credential to a trusted process callback without
   * returning it to renderer code. The callback is expected to transfer the
   * credential directly into AionCore's protected GEA boundary.
   */
  async forwardGatewayAuthSession(forward: (session: GeaGatewayAuthSession) => Promise<void>): Promise<boolean> {
    const generation = this.authGeneration;
    const accessToken = this.accessToken;
    if (!accessToken || !this.currentUser) return false;
    await forward({ accessToken, tenantId: this.currentTenantId });
    this.requireAccessToken(generation);
    return true;
  }

  async listPersonalModelCredentials(): Promise<GeaPersonalModelCredential[]> {
    const generation = this.authGeneration;
    const accessToken = this.requireAccessToken(generation);
    const credentials: GeaPersonalModelCredential[] = [];
    let pageNo = 1;

    while (true) {
      const query = new URLSearchParams({
        pageNo: String(pageNo),
        pageSize: String(PERSONAL_CREDENTIAL_PAGE_SIZE),
      });
      const payload = await this.requestPersonalModelJson<GeaResponse<PersonalCredentialListResponse>>(
        `/aidata/user-agent-credential/my/list?${query.toString()}`,
        accessToken,
        'GET',
        this.currentTenantId
      );
      if (payload.success !== true || !Array.isArray(payload.result?.records)) {
        throw new GeaPersonalModelError('GEA_PERSONAL_CREDENTIAL_LIST_INVALID');
      }

      credentials.push(...payload.result.records.map(parsePersonalCredential));
      const total = typeof payload.result.total === 'number' ? payload.result.total : credentials.length;
      if (credentials.length >= total || payload.result.records.length < PERSONAL_CREDENTIAL_PAGE_SIZE) break;
      pageNo += 1;
    }

    this.requireAccessToken(generation);
    return credentials;
  }

  async claimPersonalModelCredential(
    credentialId: string,
    tenantId: string
  ): Promise<GeaClaimedPersonalModelCredential> {
    const normalizedCredentialId = credentialId.trim();
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (!normalizedCredentialId) {
      throw new GeaPersonalModelError('GEA_PERSONAL_CREDENTIAL_ID_MISSING');
    }
    const generation = this.authGeneration;
    const accessToken = this.requireAccessToken(generation);
    const query = new URLSearchParams({ id: normalizedCredentialId });
    const payload = await this.requestPersonalModelJson<GeaResponse<PersonalCredentialClaimResponse>>(
      `/aidata/user-agent-credential/my/claim?${query.toString()}`,
      accessToken,
      'POST',
      normalizedTenantId
    );
    this.requireAccessToken(generation);
    if (payload.success !== true || !payload.result) {
      throw new GeaPersonalModelError('GEA_PERSONAL_CREDENTIAL_CLAIM_REJECTED');
    }
    return parseClaimedPersonalCredential(payload.result);
  }

  async listPersonalModels(baseUrl: string, secret: string): Promise<string[]> {
    const normalizedSecret = secret.trim();
    if (!normalizedSecret) {
      throw new GeaPersonalModelError('GEA_PERSONAL_SECRET_MISSING');
    }
    const generation = this.authGeneration;
    this.requireAccessToken(generation);
    const url = resolvePersonalModelsUrl(baseUrl);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${normalizedSecret}`,
        },
        redirect: 'error',
      });
    } catch {
      throw new GeaPersonalModelError('GEA_PERSONAL_MODELS_NETWORK_ERROR');
    }
    if (!response.ok) {
      throw new GeaPersonalModelError(`GEA_PERSONAL_MODELS_HTTP_${response.status}`);
    }
    let payload: OpenAiModelsResponse;
    try {
      payload = (await response.json()) as OpenAiModelsResponse;
    } catch {
      throw new GeaPersonalModelError('GEA_PERSONAL_MODELS_INVALID');
    }
    if (!Array.isArray(payload.data)) {
      throw new GeaPersonalModelError('GEA_PERSONAL_MODELS_INVALID');
    }
    const models = payload.data.map(parseOpenAiModelId);
    this.requireAccessToken(generation);
    return [...new Set(models)];
  }

  async createMcpGatewaySession(agentCode: string): Promise<GeaMcpGatewaySession> {
    const normalizedAgentCode = agentCode.trim();
    if (!normalizedAgentCode) {
      throw new GeaMcpGatewayError('GEA_AGENT_CODE_MISSING');
    }

    const generation = this.authGeneration;
    const accessToken = this.requireAccessToken(generation);
    const requestedConversationId = randomUUID();
    let payload: GeaResponse<GeaGatewaySessionResponse>;
    try {
      payload = await this.requestGatewayJson<GeaResponse<GeaGatewaySessionResponse>>(
        '/ai/gateway/session',
        accessToken,
        {
          consumerType: 'CLIENT_APP',
          consumerCode: normalizedAgentCode,
          requestId: randomUUID(),
          conversationId: requestedConversationId,
          channel: 'AION_WEB',
        }
      );
    } catch (error) {
      if (!(error instanceof GeaMcpGatewayError) || error.code !== 'GEA_HTTP_404') throw error;
      payload = await this.requestGatewayJson<GeaResponse<GeaGatewaySessionResponse>>(
        '/ai/gateway/agent/session',
        accessToken,
        {
          agentCode: normalizedAgentCode,
          channel: 'CS_CLIENT',
        }
      );
    }
    const gatewayContext = payload.result?.gatewayContext;
    const sessionId = gatewayContext?.sessionId?.trim() ?? '';
    const conversationId = gatewayContext?.conversationId?.trim() ?? '';
    const returnedAgentCode = gatewayContext?.agentId?.trim() || gatewayContext?.consumerCode?.trim() || '';
    const delegationToken = payload.result?.delegationToken?.trim() ?? '';
    if (
      payload.success !== true ||
      payload.result?.accessDecision?.allowed !== true ||
      returnedAgentCode !== normalizedAgentCode ||
      !sessionId ||
      !conversationId ||
      !delegationToken
    ) {
      throw new GeaMcpGatewayError(toGatewayErrorCode(payload.code, 'GEA_GATEWAY_SESSION_REJECTED'));
    }

    const sessionPayload = {
      agentCode: normalizedAgentCode,
      sessionId,
      conversationId,
      delegationToken,
    };

    let mcpClient: Client | null = null;
    let mcpConnecting: Promise<Client> | null = null;
    const getMcpClient = async (): Promise<Client> => {
      if (mcpClient) return mcpClient;
      mcpConnecting ??= (async () => {
        const currentToken = this.requireAccessToken(generation);
        const client = new Client({ name: 'aion-ui-web-host', version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(`${this.baseUrl}/ai/gateway/mcp/proxy/mcp`), {
          fetch: this.fetchImpl,
          requestInit: {
            headers: {
              Accept: 'application/json, text/event-stream',
              'X-Access-Token': currentToken,
            },
            redirect: 'error',
          },
        });
        try {
          await client.connect(transport);
          this.requireAccessToken(generation);
          mcpClient = client;
          return client;
        } catch (error) {
          await client.close().catch((): undefined => undefined);
          throw new GeaMcpGatewayError(
            error instanceof Error && error.message.includes('404')
              ? 'GEA_MCP_STREAMABLE_HTTP_UNAVAILABLE'
              : 'GEA_MCP_INITIALIZE_FAILED'
          );
        } finally {
          mcpConnecting = null;
        }
      })();
      return mcpConnecting;
    };

    return {
      listTools: async () => {
        const client = await getMcpClient();
        const response = await client.listTools({ _meta: sessionPayload });
        return response.tools.map((tool) => parseGatewayTool(tool as GeaGatewayToolResponse));
      },
      callTool: async (tool, argumentsValue = {}) => {
        const client = await getMcpClient();
        const response = await client.callTool({
          name: tool.name,
          arguments: argumentsValue,
          _meta: { ...sessionPayload, mcpCode: tool.sourceCode },
        });
        const auditId = response._meta?.auditId;
        return {
          content: response.content as ContentBlock[],
          ...(response.structuredContent !== undefined ? { result: response.structuredContent } : {}),
          ...(typeof response.isError === 'boolean' ? { isError: response.isError } : {}),
          ...(typeof auditId === 'string' && auditId.trim() ? { auditId: auditId.trim() } : {}),
        };
      },
      listResources: async (cursor) => {
        const client = await getMcpClient();
        const response = await client.listResources({
          ...(cursor ? { cursor } : {}),
          _meta: sessionPayload,
        });
        return {
          resources: response.resources,
          ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
        };
      },
      listResourceTemplates: async (cursor) => {
        const client = await getMcpClient();
        const response = await client.listResourceTemplates({
          ...(cursor ? { cursor } : {}),
          _meta: sessionPayload,
        });
        return {
          resourceTemplates: response.resourceTemplates,
          ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
        };
      },
      readResource: async (uri) => {
        const client = await getMcpClient();
        const response = await client.readResource({ uri, _meta: sessionPayload });
        return response.contents;
      },
      close: async () => {
        const client = mcpClient;
        mcpClient = null;
        if (client) await client.close();
      },
    };
  }

  private requireAccessToken(expectedGeneration: number): string {
    if (!this.accessToken || this.authGeneration !== expectedGeneration) {
      throw new GeaMcpGatewayError('GEA_LOGIN_REQUIRED');
    }
    return this.accessToken;
  }

  private async requestGatewayJson<T>(path: string, accessToken: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Access-Token': accessToken,
        },
        body: JSON.stringify(body),
        redirect: 'error',
      });
    } catch {
      throw new GeaMcpGatewayError('GEA_NETWORK_ERROR');
    }
    if (!response.ok) {
      throw new GeaMcpGatewayError(response.status === 401 ? 'GEA_LOGIN_REQUIRED' : `GEA_HTTP_${response.status}`);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new GeaMcpGatewayError('GEA_INVALID_RESPONSE');
    }
  }

  private async requestPersonalModelJson<T>(
    path: string,
    accessToken: string,
    method: 'GET' | 'POST' = 'GET',
    tenantId: string = DEFAULT_GEA_TENANT_ID
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          'X-Access-Token': accessToken,
          'X-Tenant-Id': tenantId,
        },
        redirect: 'error',
      });
    } catch {
      throw new GeaPersonalModelError('GEA_PERSONAL_NETWORK_ERROR');
    }
    if (!response.ok) {
      throw new GeaPersonalModelError(
        response.status === 401 ? 'GEA_LOGIN_REQUIRED' : `GEA_PERSONAL_HTTP_${response.status}`
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new GeaPersonalModelError('GEA_PERSONAL_INVALID_RESPONSE');
    }
  }

  private async fetchCurrentUser(
    token: string,
    signal?: AbortSignal
  ): Promise<{ tenantId?: string; user: WebHostLarkAuthUser }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/sys/user/getUserInfo`, {
        headers: { Accept: 'application/json', 'X-Access-Token': token },
        redirect: 'error',
        signal,
      });
    } catch {
      throw new GeaLarkAuthServiceError('networkError');
    }

    const payload = await readJson<UserInfoResponse>(response);
    const raw = payload.success === true ? payload.result?.userInfo : undefined;
    const id = typeof raw?.id === 'string' || typeof raw?.id === 'number' ? String(raw.id).trim() : '';
    const username = typeof raw?.username === 'string' ? raw.username.trim() : '';
    const realname = typeof raw?.realname === 'string' ? raw.realname.trim() : '';
    if (!id || (!username && !realname)) {
      throw new GeaLarkAuthServiceError('invalidResponse');
    }

    const avatar = typeof raw?.avatar === 'string' ? resolveAvatarUrl(this.baseUrl, raw.avatar) : undefined;
    const tenantId = resolveUserTenantId(raw);
    return {
      ...(tenantId ? { tenantId } : {}),
      user: {
        id,
        username,
        realname,
        ...(avatar ? { avatar } : {}),
        ...(typeof raw?.email === 'string' && raw.email.trim() ? { email: raw.email.trim() } : {}),
        ...(typeof raw?.phone === 'string' && raw.phone.trim() ? { phone: raw.phone.trim() } : {}),
      },
    };
  }

  private async restoreSession(
    session: GeaLarkAuthSession,
    sessionStore: GeaLarkAuthSessionStore,
    attemptsRemaining: number
  ): Promise<void> {
    try {
      const { tenantId, user } = await this.fetchCurrentUser(
        session.accessToken,
        AbortSignal.timeout(SESSION_RESTORE_TIMEOUT_MS)
      );
      this.acceptAuthenticatedSession(session.accessToken, tenantId ?? DEFAULT_GEA_TENANT_ID, user);
    } catch (error) {
      if (error instanceof GeaLarkAuthServiceError && (error.httpStatus === 401 || error.httpStatus === 403)) {
        await sessionStore.clear().catch(() => {});
        return;
      }
      if (!isRetryableSessionRestoreError(error) || attemptsRemaining <= 1) return;
      await new Promise((resolve) => setTimeout(resolve, SESSION_RESTORE_RETRY_DELAY_MS));
      await this.restoreSession(session, sessionStore, attemptsRemaining - 1);
    }
  }

  private acceptAuthenticatedSession(token: string, tenantId: string, user: WebHostLarkAuthUser): void {
    this.accessToken = token;
    this.authGeneration += 1;
    this.currentTenantId = tenantId;
    this.currentUser = user;
  }
}

function isRetryableSessionRestoreError(error: unknown): boolean {
  if (!(error instanceof GeaLarkAuthServiceError)) return false;
  return error.code === 'networkError' || (error.code === 'serverError' && (error.httpStatus ?? 500) >= 500);
}

function parsePersonalCredential(value: unknown): GeaPersonalModelCredential {
  if (!value || typeof value !== 'object') {
    throw new GeaPersonalModelError('GEA_PERSONAL_CREDENTIAL_INVALID');
  }
  const raw = value as Record<string, unknown>;
  const credentialId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const tenantId = normalizeTenantId(raw.tenantId);
  const accessKeyId = typeof raw.accessKeyId === 'string' ? raw.accessKeyId.trim() : '';
  const agentCode = typeof raw.agentId === 'string' ? raw.agentId.trim() : '';
  const status = parsePersonalCredentialStatus(raw.status);
  if (!credentialId || !accessKeyId || !agentCode) {
    throw new GeaPersonalModelError('GEA_PERSONAL_CREDENTIAL_INVALID');
  }
  return { credentialId, accessKeyId, agentCode, status, tenantId };
}

function normalizeTenantId(value: unknown): string {
  const tenantId = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(tenantId)) {
    throw new GeaPersonalModelError('GEA_PERSONAL_TENANT_ID_INVALID');
  }
  return tenantId;
}

function resolveUserTenantId(value: UserInfoResponse['userInfo']): string | undefined {
  const tenantId = value?.loginTenantId ?? value?.tenantId;
  if (tenantId === undefined || tenantId === null || tenantId === '') return undefined;
  try {
    return normalizeTenantId(tenantId);
  } catch {
    throw new GeaLarkAuthServiceError('invalidResponse');
  }
}

function parseClaimedPersonalCredential(value: PersonalCredentialClaimResponse): GeaClaimedPersonalModelCredential {
  const credentialId = typeof value.credentialId === 'string' ? value.credentialId.trim() : '';
  const accessKeyId = typeof value.accessKeyId === 'string' ? value.accessKeyId.trim() : '';
  const agentCode = typeof value.agentCode === 'string' ? value.agentCode.trim() : '';
  const secret = typeof value.secret === 'string' ? value.secret.trim() : '';
  const baseUrl = typeof value.baseUrl === 'string' ? normalizePersonalModelBaseUrl(value.baseUrl) : '';
  const status = parsePersonalCredentialStatus(value.status);
  if (!credentialId || !accessKeyId || !agentCode || !secret || !baseUrl || status !== 'ENABLED') {
    throw new GeaPersonalModelError('GEA_PERSONAL_CREDENTIAL_CLAIM_INVALID');
  }
  return { credentialId, accessKeyId, agentCode, secret, baseUrl, status };
}

function parsePersonalCredentialStatus(value: unknown): GeaPersonalModelCredentialStatus {
  if (
    value === 'PENDING_CLAIM' ||
    value === 'ENABLED' ||
    value === 'ROTATION_PENDING' ||
    value === 'DISABLED' ||
    value === 'REVOKED'
  ) {
    return value;
  }
  throw new GeaPersonalModelError('GEA_PERSONAL_CREDENTIAL_STATUS_INVALID');
}

function normalizePersonalModelBaseUrl(value: string): string {
  const url = new URL(value.trim());
  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1');
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new GeaPersonalModelError('GEA_PERSONAL_GATEWAY_URL_INSECURE');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function resolvePersonalModelsUrl(baseUrl: string): string {
  return `${normalizePersonalModelBaseUrl(baseUrl)}/models`;
}

function parseOpenAiModelId(value: unknown): string {
  const id =
    typeof value === 'string'
      ? value.trim()
      : value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
        ? (value as { id: string }).id.trim()
        : '';
  if (!id) {
    throw new GeaPersonalModelError('GEA_PERSONAL_MODEL_INVALID');
  }
  return id;
}

function toGatewayErrorCode(code: unknown, fallback: string): string {
  return typeof code === 'string' && code.trim() ? code.trim() : fallback;
}

function parseGatewayTool(raw: GeaGatewayToolResponse): GeaMcpGatewayTool {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const rawSourceCode = raw.sourceCode ?? raw.mcpCode ?? raw._meta?.mcpCode;
  const sourceCode = typeof rawSourceCode === 'string' ? rawSourceCode.trim() : '';
  const inputSchema =
    raw.inputSchema && typeof raw.inputSchema === 'object' && !Array.isArray(raw.inputSchema)
      ? (raw.inputSchema as Record<string, unknown>)
      : null;
  if (!name || !sourceCode || !inputSchema) {
    throw new GeaMcpGatewayError('GEA_INVALID_TOOL_RESPONSE');
  }
  return {
    name,
    sourceCode,
    inputSchema,
    ...(typeof raw.description === 'string' && raw.description.trim() ? { description: raw.description.trim() } : {}),
  };
}

async function asResult<T>(operation: () => Promise<T>): Promise<WebHostLarkAuthResult<T>> {
  try {
    return { success: true, data: await operation() };
  } catch (error) {
    return {
      success: false,
      code: error instanceof GeaLarkAuthServiceError ? error.code : 'serverError',
    };
  }
}

export function createGeaLarkAuth(): WebHostLarkAuth {
  const service = new GeaLarkAuthService();
  return {
    createQrSession: () => asResult(() => service.createQrSession()),
    getEnvironment: () => ({
      baseUrl: service.getBaseUrl(),
      editable: false,
      environmentId: createGeaEnvironmentId(service.getBaseUrl()),
      source: process.env.AIONUI_GEA_BASE_URL
        ? 'environment'
        : process.env.AUTH_BROKER_PUBLIC_URL
          ? 'legacyEnvironment'
          : 'default',
    }),
    pollQrSession: (qrcodeId) => asWebHostPoll(() => service.pollQrSessionWithIdentity(qrcodeId)),
  };
}

export function buildLarkExternalIdentity(
  issuer: string,
  tenantId: string,
  subject: string
): WebHostLarkExternalIdentity {
  return { provider: 'lark', issuer, tenant_id: tenantId, subject };
}

async function asWebHostPoll(operation: () => Promise<GeaVerifiedLarkQrLogin>): Promise<WebHostLarkAuthPoll> {
  try {
    const { identity, result } = await operation();
    return { ...(identity ? { identity } : {}), publicResult: { success: true, data: result } };
  } catch (error) {
    return {
      publicResult: {
        success: false,
        code: error instanceof GeaLarkAuthServiceError ? error.code : 'serverError',
      },
    };
  }
}
