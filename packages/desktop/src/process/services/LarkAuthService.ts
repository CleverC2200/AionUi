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

export { GeaLarkAuthService as LarkAuthService, GeaLarkAuthServiceError as LarkAuthServiceError };

const LARK_AUTH_SESSION_FILE_NAME = 'lark-auth-session.bin';
const LEGACY_GEA_BASE_URL = 'https://gea.synear.cn/gea-boot';
const DEFAULT_GEA_BASE_URL = 'https://gea.synear.cn:4443/gea-boot';
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
const sharedLarkAuthService = new GeaLarkAuthService();
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
  return sharedLarkAuthService.initializeSession(sessionStore);
}

export function getSharedLarkAuthSessionStore(): ElectronLarkAuthSessionStore {
  sharedLarkAuthSessionStore ??= new ElectronLarkAuthSessionStore(
    path.join(
      app.getPath('userData'),
      resolveLarkAuthSessionFileName(
        process.env.AIONUI_GEA_BASE_URL ?? process.env.AUTH_BROKER_PUBLIC_URL ?? DEFAULT_GEA_BASE_URL
      )
    )
  );
  return sharedLarkAuthSessionStore;
}

export function resolveLarkAuthSessionFileName(baseUrl: string): string {
  const normalizedBaseUrl = new URL(baseUrl).toString().replace(/\/$/, '');
  if (normalizedBaseUrl === LEGACY_GEA_BASE_URL) return LARK_AUTH_SESSION_FILE_NAME;
  const environmentKey = createHash('sha256').update(normalizedBaseUrl).digest('hex').slice(0, 12);
  return `lark-auth-session-${environmentKey}.bin`;
}

export async function pollSharedLarkAuthSession(qrcodeId: string): Promise<LarkQrLoginPollResult> {
  const result = await sharedLarkAuthService.pollQrSession(qrcodeId);
  if (result.status !== 'authenticated' || !result.user) return result;
  await syncSharedGeaSessionToBackend({ replaceInvalidated: true });
  if (!personalModelGateway) return result;
  let personalModelSync: PersonalModelSyncResult;
  try {
    personalModelSync = await personalModelGateway.sync(result.user, sharedLarkAuthService);
  } catch {
    personalModelSync = { configured: 0, failed: 1, skipped: 0, status: 'partial' };
  }
  return { ...result, personalModelSync };
}

export async function syncSharedPersonalModels(): Promise<PersonalModelSyncResult> {
  const status = sharedLarkAuthService.getStatus();
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
  return personalModelGateway.sync(status.user, sharedLarkAuthService);
}

export async function logoutSharedLarkAuthSession(): Promise<void> {
  await httpRequest<void>('DELETE', '/api/gea/auth/session').catch(() => {});
  await sharedLarkAuthService.logout();
  await personalModelGateway?.deactivate().catch(() => {});
}

export function resolveDesktopLarkAuthStatus(isPackaged: boolean, status: LarkAuthStatus): LarkAuthStatus {
  return isPackaged || process.env[REQUIRE_GEA_AUTH_ENV] === '1' || (status.authenticated && status.user)
    ? status
    : DEVELOPMENT_LOCAL_AUTH_STATUS;
}

export function getSharedLarkAuthService(): GeaLarkAuthService {
  return sharedLarkAuthService;
}

export async function syncSharedGeaSessionToBackend(options: { replaceInvalidated?: boolean } = {}): Promise<boolean> {
  const localStatus = sharedLarkAuthService.getStatus();
  if (!localStatus.authenticated) return false;

  if (options.replaceInvalidated !== true) {
    const backendStatus = await httpRequest<GeaBackendAuthSessionStatus>('GET', '/api/gea/auth/session');
    if (backendStatus.authenticated) return true;
    if (backendStatus.reauthRequired) {
      await sharedLarkAuthService.logout();
      await personalModelGateway?.deactivate().catch(() => {});
      return false;
    }
  }

  return sharedLarkAuthService.forwardGatewayAuthSession(({ accessToken, tenantId }) =>
    httpRequest<void>('PUT', '/api/gea/auth/session', { accessToken, tenantId })
  );
}

export function createSharedWebHostLarkAuth(): WebHostLarkAuth {
  return {
    createQrSession: async () => {
      try {
        return { success: true, data: await sharedLarkAuthService.createQrSession() };
      } catch (error) {
        return {
          success: false,
          code: error instanceof GeaLarkAuthServiceError ? error.code : 'serverError',
        };
      }
    },
    pollQrSession: async (qrcodeId) => {
      try {
        return { success: true, data: await pollSharedLarkAuthSession(qrcodeId) };
      } catch (error) {
        return {
          success: false,
          code: error instanceof GeaLarkAuthServiceError ? error.code : 'serverError',
        };
      }
    },
    logout: logoutSharedLarkAuthSession,
  };
}
