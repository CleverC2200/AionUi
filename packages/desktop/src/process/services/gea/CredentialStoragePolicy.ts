/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';

type CredentialStoragePolicyOptions = {
  inspect?: (appBundlePath: string) => string | null;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
};

function inspectMacCodeSignature(appBundlePath: string): string | null {
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appBundlePath], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

export function shouldUsePersistentCredentialStorage(options: CredentialStoragePolicyOptions = {}): boolean {
  const platform = options.platform ?? process.platform;
  const isPackaged = options.isPackaged ?? app.isPackaged;
  if (platform !== 'darwin' || !isPackaged) return true;

  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const signature = (options.inspect ?? inspectMacCodeSignature)(path.resolve(resourcesPath, '../..'));
  if (!signature) return false;

  const authority = signature.match(/^Authority=(.+)$/m)?.[1]?.trim();
  const rawSignature = signature.match(/^Signature=(.+)$/m)?.[1]?.trim();
  const teamIdentifier = signature.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim();
  return rawSignature !== 'adhoc' && Boolean(authority || (teamIdentifier && teamIdentifier !== 'not set'));
}
