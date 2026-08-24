/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { httpRequest } from '@/common/adapter/httpBridge';
import {
  GeaLarkAuthService,
  GeaLarkAuthServiceError,
  normalizeGeaBaseUrl,
  type GeaLarkAuthSession,
  type GeaLarkAuthSessionStore,
  type WebHostLarkAuth,
} from '@aionui/web-host';
import type {
  LarkAuthStatus,
  LarkAuthUser,
  LarkQrLoginPollResult,
  PersonalModelSyncResult,
} from '@/common/types/platform/larkAuth';
import type { PersonalModelAuthClient } from './PersonalModelGatewayService';
import { getGeaEnvironment } from './GeaEnvironmentService';

export { GeaLarkAuthService as LarkAuthService, GeaLarkAuthServiceError as LarkAuthServiceError };

const LARK_AUTH_SESSION_FILE_NAME = 'lark-auth-session.bin';
const LEGACY_GEA_BASE_URL = 'https://gea.synear.cn/gea-boot';
const REQUIRE_GEA_AUTH_ENV = 'AIONUI_GEA_REQUIRE_AUTH';
// Desktop development uses AionCore's local identity so restarts do not require
// another QR scan. Live GEA integration can opt into the real authentication UI.
const DEVELOPMENT_LOCAL_AUTH_STATUS: LarkAuthStatus = {
  authenticated: true,
  user: {
    id: 'system_default_user',
    realname: 'admin',
    username: 'admin',
  },
};
let sharedLarkAuthService: GeaLarkAuthService | null = null;
let sharedLarkAuthSessionStore: ElectronLarkAuthSessionStore | null = null;

type StoredLarkAuthSession = GeaLarkAuthSession & { version: 1 };
type GeaBackendAuthSessionStatus = {
  authenticated: boolean;
  reauthRequired: boolean;
  tenantId?: string;
};

export type LarkAuthSafeStorageAdapter = Pick<
  typeof safeStorage,
  'decryptString' | 'encryptString' | 'getSelectedStorageBackend' | 'isEncryptionAvailable'
>;

export class ElectronLarkAuthSessionStore implements GeaLarkAuthSessionStore {
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly storage: LarkAuthSafeStorageAdapter = safeStorage
  ) {}

  async load(): Promise<GeaLarkAuthSession | null> {
    await this.mutation;
    if (!this.isAvailable()) return null;

    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }

    try {
      const parsed = JSON.parse(this.storage.decryptString(encrypted)) as unknown;
      return isStoredLarkAuthSession(parsed) ? { accessToken: parsed.accessToken } : await this.clearInvalidSession();
    } catch {
      return this.clearInvalidSession();
    }
  }

  save(session: GeaLarkAuthSession): Promise<void> {
    if (!this.isAvailable()) return Promise.reject(new Error('secure storage unavailable'));
    return this.enqueueMutation(async () => {
      const contents: StoredLarkAuthSession = { version: 1, accessToken: session.accessToken };
      const encrypted = this.storage.encryptString(JSON.stringify(contents));
      const tempPath = `${this.filePath}.${process.pid}.tmp`;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      try {
        await writeFile(tempPath, encrypted, { mode: 0o600 });
        await rename(tempPath, this.filePath);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    });
  }

  clear(): Promise<void> {
    return this.enqueueMutation(async () => {
      await unlink(this.filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    });
  }

  private isAvailable(): boolean {
    if (!this.storage.isEncryptionAvailable()) return false;
    return process.platform !== 'linux' || this.storage.getSelectedStorageBackend() !== 'basic_text';
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    this.mutation = this.mutation.then(operation, operation);
    return this.mutation;
  }

  private async clearInvalidSession(): Promise<null> {
    await this.clear();
    return null;
  }
}

function isStoredLarkAuthSession(value: unknown): value is StoredLarkAuthSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<StoredLarkAuthSession>;
  return session.version === 1 && typeof session.accessToken === 'string' && session.accessToken.trim() !== '';
}

type PersonalModelGatewayLifecycle = {
  deactivate: () => Promise<void>;
  sync: (user: LarkAuthUser, authClient: PersonalModelAuthClient) => Promise<PersonalModelSyncResult>;
};

let personalModelGateway: PersonalModelGatewayLifecycle | null = null;

export function configureSharedPersonalModelGateway(lifecycle: PersonalModelGatewayLifecycle): void {
  personalModelGateway = lifecycle;
}

export async function initializeSharedPersonalModelGateway(
  lifecycle: PersonalModelGatewayLifecycle
): Promise<PersonalModelSyncResult> {
  configureSharedPersonalModelGateway(lifecycle);
  return syncSharedPersonalModels();
}

export function initializeSharedLarkAuthSession(sessionStore: GeaLarkAuthSessionStore): Promise<void> {
  return getSharedLarkAuthService().initializeSession(sessionStore);
}

export function getSharedLarkAuthSessionStore(): ElectronLarkAuthSessionStore {
  sharedLarkAuthSessionStore ??= new ElectronLarkAuthSessionStore(
    path.join(app.getPath('userData'), resolveLarkAuthSessionFileName(getGeaEnvironment().baseUrl))
  );
  return sharedLarkAuthSessionStore;
}

export function resolveLarkAuthSessionFileName(baseUrl: string): string {
  const normalizedBaseUrl = normalizeGeaBaseUrl(baseUrl, { allowLoopbackHttp: true });
  if (normalizedBaseUrl === LEGACY_GEA_BASE_URL) return LARK_AUTH_SESSION_FILE_NAME;
  const environmentKey = createHash('sha256').update(normalizedBaseUrl).digest('hex').slice(0, 12);
  return `lark-auth-session-${environmentKey}.bin`;
}

export async function pollSharedLarkAuthSession(qrcodeId: string): Promise<LarkQrLoginPollResult> {
  return (await pollSharedLarkAuthSessionWithIdentity(qrcodeId)).result;
}

async function pollSharedLarkAuthSessionWithIdentity(qrcodeId: string) {
  const service = getSharedLarkAuthService();
  const verified = await service.pollQrSessionWithIdentity(qrcodeId);
  const result = verified.result;
  if (result.status !== 'authenticated' || !result.user) return verified;
  await syncSharedGeaSessionToBackend({ replaceInvalidated: true });
  if (!personalModelGateway) return verified;
  let personalModelSync: PersonalModelSyncResult;
  try {
    personalModelSync = await personalModelGateway.sync(result.user, service);
  } catch {
    personalModelSync = { configured: 0, failed: 1, skipped: 0, status: 'partial' };
  }
  return { ...verified, result: { ...result, personalModelSync } };
}

export async function syncSharedPersonalModels(): Promise<PersonalModelSyncResult> {
  const service = getSharedLarkAuthService();
  const status = service.getStatus();
  if (!status.authenticated || !status.user) {
    await personalModelGateway?.deactivate().catch(() => {});
    return {
      configured: 0,
      failed: 0,
      reason: 'notAuthenticated',
      skipped: 0,
      status: 'notAuthenticated',
    };
  }
  if (!personalModelGateway) {
    return {
      configured: 0,
      failed: 1,
      reason: 'providerListFailed',
      skipped: 0,
      status: 'partial',
    };
  }
  return personalModelGateway.sync(status.user, service);
}

export async function logoutSharedLarkAuthSession(): Promise<void> {
  await httpRequest<void>('DELETE', '/api/gea/auth/session').catch(() => {});
  await getSharedLarkAuthService().logout();
  await personalModelGateway?.deactivate().catch(() => {});
}

export function resolveDesktopLarkAuthStatus(isPackaged: boolean, status: LarkAuthStatus): LarkAuthStatus {
  return isPackaged || process.env[REQUIRE_GEA_AUTH_ENV] === '1' || (status.authenticated && status.user)
    ? status
    : DEVELOPMENT_LOCAL_AUTH_STATUS;
}

export function getSharedLarkAuthService(): GeaLarkAuthService {
  sharedLarkAuthService ??= new GeaLarkAuthService({
    // The Main-owned environment resolver already enforces packaged HTTPS.
    // Preserve loopback HTTP only for the validated development/E2E profile.
    allowLoopbackHttp: true,
    baseUrl: getGeaEnvironment().baseUrl,
  });
  return sharedLarkAuthService;
}

export async function syncSharedGeaSessionToBackend(options: { replaceInvalidated?: boolean } = {}): Promise<boolean> {
  const service = getSharedLarkAuthService();
  const localStatus = service.getStatus();
  if (!localStatus.authenticated) return false;

  if (options.replaceInvalidated !== true) {
    const backendStatus = await httpRequest<GeaBackendAuthSessionStatus>('GET', '/api/gea/auth/session');
    if (backendStatus.authenticated) return true;
    if (backendStatus.reauthRequired) {
      await service.logout();
      await personalModelGateway?.deactivate().catch(() => {});
      return false;
    }
  }

  return service.forwardGatewayAuthSession(({ accessToken, tenantId }) =>
    httpRequest<void>('PUT', '/api/gea/auth/session', { accessToken, tenantId })
  );
}

export function createSharedWebHostLarkAuth(): WebHostLarkAuth {
  return {
    createQrSession: async () => {
      try {
        return { success: true, data: await getSharedLarkAuthService().createQrSession() };
      } catch (error) {
        return {
          success: false,
          code: error instanceof GeaLarkAuthServiceError ? error.code : 'serverError',
        };
      }
    },
    getEnvironment: () => ({ ...getGeaEnvironment(), editable: false }),
    pollQrSession: async (qrcodeId) => {
      try {
        const { identity, result } = await getSharedLarkAuthService().pollQrSessionWithIdentity(qrcodeId);
        return { ...(identity ? { identity } : {}), publicResult: { success: true, data: result } };
      } catch (error) {
        return {
          publicResult: {
            success: false,
            code: error instanceof GeaLarkAuthServiceError ? error.code : 'serverError',
          },
        };
      }
    },
  };
}

export function resetSharedLarkAuthServiceForTests(): void {
  sharedLarkAuthService = null;
  sharedLarkAuthSessionStore = null;
}
