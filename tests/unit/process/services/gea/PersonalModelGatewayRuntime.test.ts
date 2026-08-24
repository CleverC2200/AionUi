/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/unused') },
  safeStorage: {},
}));

vi.mock('@/common', () => ({ ipcBridge: { mode: {} } }));

import { ElectronSafeStorageVault, type SafeStorageAdapter } from '@/process/services/gea/PersonalModelGatewayRuntime';

const xor = (value: Buffer): Buffer => Buffer.from(value.map((byte) => byte ^ 0xa5));

describe('ElectronSafeStorageVault', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('persists the personal secret only as encrypted bytes', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'aionui-personal-vault-'));
    const filePath = path.join(tempDir, 'vault.bin');
    const storage: SafeStorageAdapter = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (value) => xor(Buffer.from(value, 'utf8')),
      decryptString: (value) => xor(value).toString('utf8'),
    };
    const vault = new ElectronSafeStorageVault(filePath, storage);
    const record = {
      environmentId: 'gea-env-a',
      userId: 'user-1',
      credentialId: 'credential-1',
      accessKeyId: 'uk-gea-1',
      agentCode: 'sales-forecast',
      baseUrl: 'https://gea.example/v1',
      proxyKey: 'local-proxy-key',
      secret: 'sk-user-sensitive',
    };

    await vault.put(record);

    const persisted = await readFile(filePath);
    expect(persisted.toString('utf8')).not.toContain(record.secret);
    await expect(vault.get(record.environmentId, record.userId, record.credentialId)).resolves.toEqual(record);
  });

  it('refuses to claim credentials when encryption is unavailable', () => {
    const storage: SafeStorageAdapter = {
      isEncryptionAvailable: () => false,
      getSelectedStorageBackend: () => 'unknown',
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    };
    const vault = new ElectronSafeStorageVault('/unused', storage);

    expect(vault.isAvailable()).toBe(false);
  });

  it('does not reuse legacy vault records that lack a GEA environment identity', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'aionui-personal-vault-'));
    const filePath = path.join(tempDir, 'vault.bin');
    const storage: SafeStorageAdapter = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (value) => xor(Buffer.from(value, 'utf8')),
      decryptString: (value) => xor(value).toString('utf8'),
    };
    await writeFile(
      filePath,
      storage.encryptString(
        JSON.stringify({
          version: 1,
          entries: {
            legacy: {
              userId: 'user-1',
              credentialId: 'credential-1',
              accessKeyId: 'uk-gea-1',
              agentCode: 'sales-forecast',
              baseUrl: 'https://gea.example/v1',
              proxyKey: 'local-proxy-key',
              secret: 'sk-user-sensitive',
            },
          },
        })
      )
    );
    const vault = new ElectronSafeStorageVault(filePath, storage);

    await expect(vault.get('gea-env-a', 'user-1', 'credential-1')).resolves.toBeNull();
  });
});
