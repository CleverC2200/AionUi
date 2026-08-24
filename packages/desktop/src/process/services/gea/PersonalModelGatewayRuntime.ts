/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import {
  PersonalModelGatewayService,
  type PersonalModelProviderStore,
  type PersonalModelSecretRecord,
  type PersonalModelSecretVault,
} from './PersonalModelGatewayService';
import { getGeaEnvironment } from './GeaEnvironmentService';

const VAULT_FILE_NAME = 'personal-model-vault.bin';

type VaultContents = {
  entries: Record<string, PersonalModelSecretRecord>;
  version: 2;
};

export type SafeStorageAdapter = Pick<
  typeof safeStorage,
  'decryptString' | 'encryptString' | 'getSelectedStorageBackend' | 'isEncryptionAvailable'
>;

export class ElectronSafeStorageVault implements PersonalModelSecretVault {
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly storage: SafeStorageAdapter = safeStorage
  ) {}

  isAvailable(): boolean {
    if (!this.storage.isEncryptionAvailable()) return false;
    return process.platform !== 'linux' || this.storage.getSelectedStorageBackend() !== 'basic_text';
  }

  async get(environmentId: string, userId: string, credentialId: string): Promise<PersonalModelSecretRecord | null> {
    await this.mutation;
    const contents = await this.readContents();
    const record = contents.entries[vaultKey(environmentId, userId, credentialId)] ?? null;
    return record?.environmentId === environmentId && record.userId === userId && record.credentialId === credentialId
      ? record
      : null;
  }

  put(record: PersonalModelSecretRecord): Promise<void> {
    return this.enqueueMutation(async () => {
      const contents = await this.readContents();
      contents.entries[vaultKey(record.environmentId, record.userId, record.credentialId)] = record;
      await this.writeContents(contents);
    });
  }

  delete(environmentId: string, userId: string, credentialId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const contents = await this.readContents();
      delete contents.entries[vaultKey(environmentId, userId, credentialId)];
      await this.writeContents(contents);
    });
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    this.mutation = this.mutation.then(operation, operation);
    return this.mutation;
  }

  private async readContents(): Promise<VaultContents> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 2, entries: {} };
      }
      throw error;
    }
    const parsed = JSON.parse(this.storage.decryptString(encrypted)) as unknown;
    if (isLegacyVaultContents(parsed)) {
      // V1 records did not identify their GEA environment and cannot be safely reused.
      return { version: 2, entries: {} };
    }
    if (!isVaultContents(parsed)) {
      throw new Error('GEA_PERSONAL_VAULT_INVALID');
    }
    return parsed;
  }

  private async writeContents(contents: VaultContents): Promise<void> {
    const encrypted = this.storage.encryptString(JSON.stringify(contents));
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await writeFile(tempPath, encrypted, { mode: 0o600 });
      await rename(tempPath, this.filePath);
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  }
}

class AionCoreProviderStore implements PersonalModelProviderStore {
  async list(): Promise<IProvider[]> {
    return (await ipcBridge.mode.listProviders.invoke()) ?? [];
  }

  async save(provider: IProvider, exists: boolean): Promise<void> {
    if (exists) {
      const { id, ...updates } = provider;
      await ipcBridge.mode.updateProvider.invoke({ id, ...updates });
      return;
    }
    await ipcBridge.mode.createProvider.invoke(provider);
  }
}

let runtime: PersonalModelGatewayService | null = null;

export function getPersonalModelGatewayRuntime(): PersonalModelGatewayService {
  runtime ??= new PersonalModelGatewayService(
    new ElectronSafeStorageVault(path.join(app.getPath('userData'), VAULT_FILE_NAME)),
    new AionCoreProviderStore(),
    getGeaEnvironment().environmentId
  );
  return runtime;
}

function vaultKey(environmentId: string, userId: string, credentialId: string): string {
  return createHash('sha256').update(`${environmentId}\0${userId}\0${credentialId}`).digest('hex');
}

function isVaultContents(value: unknown): value is VaultContents {
  if (!value || typeof value !== 'object') return false;
  const raw = value as { entries?: unknown; version?: unknown };
  if (raw.version !== 2 || !raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) return false;
  return Object.values(raw.entries as Record<string, unknown>).every(isSecretRecord);
}

function isLegacyVaultContents(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const raw = value as { entries?: unknown; version?: unknown };
  return raw.version === 1 && raw.entries !== null && typeof raw.entries === 'object' && !Array.isArray(raw.entries);
}

function isSecretRecord(value: unknown): value is PersonalModelSecretRecord {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return ['accessKeyId', 'agentCode', 'baseUrl', 'credentialId', 'environmentId', 'proxyKey', 'secret', 'userId'].every(
    (key) => typeof raw[key] === 'string' && (raw[key] as string).length > 0
  );
}
