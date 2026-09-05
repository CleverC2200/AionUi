/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';

vi.mock('electron', () => ({
  app: { isPackaged: true },
}));

import { shouldUsePersistentCredentialStorage } from '@/process/services/gea/CredentialStoragePolicy';

describe('CredentialStoragePolicy', () => {
  it('disables persistent credentials for an ad-hoc signed packaged macOS app', () => {
    const inspect = vi.fn(() => 'Signature=adhoc\nTeamIdentifier=not set\n');

    expect(
      shouldUsePersistentCredentialStorage({
        inspect,
        isPackaged: true,
        platform: 'darwin',
        resourcesPath: '/Applications/GEAUi.app/Contents/Resources',
      })
    ).toBe(false);
    expect(inspect).toHaveBeenCalledWith(path.resolve('/Applications/GEAUi.app'));
  });

  it('allows persistent credentials for a stable signed packaged macOS app', () => {
    expect(
      shouldUsePersistentCredentialStorage({
        inspect: () => 'Signature size=8978\nTeamIdentifier=TEAM123456\n',
        isPackaged: true,
        platform: 'darwin',
        resourcesPath: '/Applications/GEAUi.app/Contents/Resources',
      })
    ).toBe(true);
  });

  it('allows persistent credentials for a certificate-signed local macOS app', () => {
    expect(
      shouldUsePersistentCredentialStorage({
        inspect: () => 'Authority=GEAUi Local Code Signing\nSignature size=2048\nTeamIdentifier=not set\n',
        isPackaged: true,
        platform: 'darwin',
        resourcesPath: '/Applications/GEAUi.app/Contents/Resources',
      })
    ).toBe(true);
  });

  it('keeps persistent credentials enabled outside packaged macOS without inspecting a signature', () => {
    const inspect = vi.fn();

    expect(
      shouldUsePersistentCredentialStorage({
        inspect,
        isPackaged: false,
        platform: 'darwin',
        resourcesPath: '/unused',
      })
    ).toBe(true);
    expect(inspect).not.toHaveBeenCalled();
  });
});
