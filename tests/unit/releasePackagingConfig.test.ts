import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const projectRoot = resolve(__dirname, '../..');
const itWithBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? it : it.skip;

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function yamlBlock(content: string, key: string): string {
  const startMatch = content.match(new RegExp(`^${key}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';

  const blockStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(blockStart);
  const nextTopLevelKey = rest.search(/^[a-zA-Z][a-zA-Z0-9]*:\s*$/m);
  return nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
}

describe('release packaging configuration', () => {
  it('keeps mac zip artifacts enabled', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const macBlock = yamlBlock(config, 'mac');

    expect(macBlock).toContain('    - dmg');
    expect(macBlock).toContain('    - zip');
  });

  it('does not build Windows zip artifacts', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');

    expect(winBlock).toContain('    - nsis');
    expect(winBlock).not.toContain('    - zip');
  });

  it('keeps Windows installer executable checks aligned with electron-builder', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const executableName = config.match(/^executableName:\s*(.+)$/m)?.[1]?.trim();
    const observability = readProjectFile('resources/windows/installer-observability.nsh');
    const updateVerify = readProjectFile('resources/windows/installer-update-verify.nsh');

    expect(executableName).toBeTruthy();
    expect(observability).toContain(`!define AIONUI_APP_EXECUTABLE_FILENAME "${executableName}.exe"`);
    expect(observability).toContain('${FileExists} "$INSTDIR\\${AIONUI_APP_EXECUTABLE_FILENAME}"');
    expect(updateVerify).toContain('AIONUI_VERIFY_REQUIRED_FILE "$INSTDIR\\${AIONUI_APP_EXECUTABLE_FILENAME}"');
  });

  it('uploads mac zip artifacts without a stale Windows zip glob', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).toContain('out/GEAUi-*-mac-*.zip');
    expect(workflow).not.toContain('out/GEAUi-*-win32-*.zip');
  });

  it('fetches stable AionCore artifacts without freezing provenance as product identity', () => {
    const releaseWorkflow = readProjectFile('.github/workflows/build-and-release.yml');
    const reusableWorkflow = readProjectFile('.github/workflows/_build-reusable.yml');
    const webWorkflow = readProjectFile('.github/workflows/pack-web-cli.yml');

    expect(releaseWorkflow.match(/aioncore_repository: 'CleverC2200\/AionCore'/g)).toHaveLength(2);
    expect(releaseWorkflow.match(/aioncore_run_id: \$\{\{ vars\.AIONCORE_STABLE_RUN_ID \}\}/g)).toHaveLength(2);
    expect(releaseWorkflow.match(/aioncore_source_policy: 'verified-actions'/g)).toHaveLength(2);
    expect(releaseWorkflow).not.toContain('AIONCORE_STABLE_HEAD_SHA');
    expect(releaseWorkflow).not.toContain('AIONCORE_STABLE_SHA256S');

    expect(reusableWorkflow).toContain("default: 'CleverC2200/AionCore'");
    expect(
      reusableWorkflow.match(/AIONUI_BACKEND_EXPECTED_HEAD_SHA: \$\{\{ inputs\.aioncore_expected_head_sha \}\}/g)
    ).toHaveLength(4);
    expect(reusableWorkflow.match(/AIONUI_BACKEND_SHA256S: \$\{\{ inputs\.aioncore_sha256s \}\}/g)).toHaveLength(4);
    expect(
      reusableWorkflow.match(/AIONUI_BACKEND_SOURCE_POLICY: \$\{\{ inputs\.aioncore_source_policy \}\}/g)
    ).toHaveLength(4);
    expect(webWorkflow).toContain('AIONUI_BACKEND_SHA256S: ${{ inputs.aioncore_sha256s }}');
    expect(webWorkflow).toContain('AIONUI_BACKEND_EXPECTED_HEAD_SHA: ${{ inputs.aioncore_expected_head_sha }}');
    expect(webWorkflow).toContain("AIONUI_BACKEND_SOURCE_POLICY: ${{ inputs.aioncore_source_policy || 'default' }}");
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  itWithBash('fails release asset preparation when a mac zip is missing', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'aionui-release-assets-'));
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      const createResult = spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });
      expect(createResult.status).toBe(0);

      rmSync(resolve(artifactsDir, 'macos-build-arm64', 'GEAUi-1.0.0-mac-arm64.zip'), { force: true });

      const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsDir, outputDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });

      expect(prepareResult.status).not.toBe(0);
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('Missing macOS zip artifact');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
