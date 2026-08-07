/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ManagedVoiceCapability } from '@/common/types/voice';

let capabilityRequest: Promise<ManagedVoiceCapability> | null = null;

export const getManagedVoiceCapability = (): Promise<ManagedVoiceCapability> => {
  const provider = ipcBridge.voice?.getCapability;
  capabilityRequest ??= provider
    ? provider.invoke().catch(() => ({ enabled: false }))
    : Promise.resolve({ enabled: false });
  return capabilityRequest;
};

export const clearManagedVoiceCapabilityCache = (): void => {
  capabilityRequest = null;
};
