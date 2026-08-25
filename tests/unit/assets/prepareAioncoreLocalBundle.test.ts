import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { prepareAioncore } = require('../../../packages/shared-scripts/src/prepare-aioncore');
const {
  sha256Directory,
  sha256File,
} = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');

describe('prepare-aioncore local bundle input', () => {
  it('records final bundle content identities separately from source provenance', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    const managedResources = join(localBundle, 'managed-resources');
    const nodeRoot = join(managedResources, 'node', 'node-v24.11.0-win-x64');
    mkdirSync(nodeRoot, { recursive: true });
    writeFileSync(join(localBundle, 'aioncore.exe'), 'binary');
    writeFileSync(join(nodeRoot, 'node.exe'), 'node');
    writeFileSync(
      join(managedResources, 'manifest.json'),
      `${JSON.stringify({
        schemaVersion: 2,
        runtimeKey: 'win32-x64',
        node: {
          version: '24.11.0',
          root: 'node/node-v24.11.0-win-x64',
          executable: 'node.exe',
        },
        clis: [],
      })}\n`
    );

    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      prepareAioncore({ projectRoot, platform: 'win32', arch: 'x64', version: 'v0.1.46' });
      const targetDir = join(projectRoot, 'resources', 'bundled-aioncore', 'win32-x64');
      const manifest = JSON.parse(readFileSync(join(targetDir, 'manifest.json'), 'utf8'));

      expect(manifest.sourceType).toBe('local-bundle');
      expect(manifest.content).toEqual({
        binary: { path: 'aioncore.exe', sha256: sha256File(join(targetDir, 'aioncore.exe')) },
        managedResources: {
          path: 'managed-resources',
          sha256: sha256Directory(join(targetDir, 'managed-resources')),
        },
      });
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('hard fails local bundle input that lacks managed-resources manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    mkdirSync(join(localBundle, 'managed-resources'), { recursive: true });
    writeFileSync(join(localBundle, 'aioncore.exe'), '');

    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      expect(() =>
        prepareAioncore({
          projectRoot,
          platform: 'win32',
          arch: 'x64',
          version: 'v0.1.46',
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
