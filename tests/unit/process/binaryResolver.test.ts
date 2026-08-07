/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readdirSync: vi.fn() }));

import { resolveBinaryPath } from '@/process/backend/binaryResolver';

describe('aioncore binary override', () => {
  const previousOverride = process.env.AIONUI_AIONCORE_BINARY;

  afterEach(() => {
    vi.clearAllMocks();
    if (previousOverride === undefined) delete process.env.AIONUI_AIONCORE_BINARY;
    else process.env.AIONUI_AIONCORE_BINARY = previousOverride;
  });

  it('uses the explicit development binary before bundled and PATH lookup', () => {
    const binary = '/workspace/AionCore/target/debug/aioncore';
    process.env.AIONUI_AIONCORE_BINARY = binary;
    vi.mocked(existsSync).mockImplementation((path) => path === binary);

    expect(resolveBinaryPath()).toBe(binary);
    expect(execSync).not.toHaveBeenCalled();
  });
});
