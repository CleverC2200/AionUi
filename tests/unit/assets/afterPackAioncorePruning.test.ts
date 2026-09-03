import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const { pruneNonTargetBundledAioncore } = require('../../../scripts/afterPack.js') as {
  pruneNonTargetBundledAioncore: (resourcesDir: string, electronPlatformName: string, targetArch: string) => string[];
};

const temporaryDirectories: string[] = [];

describe('afterPack AionCore runtime pruning', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps only the target platform runtime in the packaged resources', () => {
    const resourcesDir = mkdtempSync(join(tmpdir(), 'aionui-after-pack-'));
    temporaryDirectories.push(resourcesDir);
    const bundledRoot = join(resourcesDir, 'bundled-aioncore');
    for (const runtimeKey of ['darwin-arm64', 'win32-x64', 'linux-x64']) {
      mkdirSync(join(bundledRoot, runtimeKey), { recursive: true });
    }
    mkdirSync(join(bundledRoot, 'shared-metadata'), { recursive: true });
    writeFileSync(join(bundledRoot, 'README.txt'), 'keep');

    expect(pruneNonTargetBundledAioncore(resourcesDir, 'darwin', 'arm64').sort()).toEqual(['linux-x64', 'win32-x64']);
    expect(existsSync(join(bundledRoot, 'darwin-arm64'))).toBe(true);
    expect(existsSync(join(bundledRoot, 'win32-x64'))).toBe(false);
    expect(existsSync(join(bundledRoot, 'linux-x64'))).toBe(false);
    expect(existsSync(join(bundledRoot, 'shared-metadata'))).toBe(true);
    expect(existsSync(join(bundledRoot, 'README.txt'))).toBe(true);
  });
});
