/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dataDir: '/tmp/aionui-e2e-userdata-regression' }));

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: {
      getDataDir: () => mocks.dataDir,
      getHomeDir: () => '/tmp/home-that-must-not-be-used',
      getTempDir: () => '/tmp',
      isPackaged: () => false,
      needsCliSafeSymlinks: () => true,
    },
  }),
}));

import { getConfigPath, getDataPath } from '@/process/utils/utils';

describe('E2E data path isolation', () => {
  const previousE2E = process.env.AIONUI_E2E_TEST;

  afterEach(() => {
    if (previousE2E === undefined) delete process.env.AIONUI_E2E_TEST;
    else process.env.AIONUI_E2E_TEST = previousE2E;
  });

  it('uses the disposable sandbox directly instead of the global dev symlink', () => {
    process.env.AIONUI_E2E_TEST = '1';

    expect(getDataPath()).toBe(path.join(mocks.dataDir, 'aionui'));
    expect(getConfigPath()).toBe(path.join(mocks.dataDir, 'config'));
  });
});
