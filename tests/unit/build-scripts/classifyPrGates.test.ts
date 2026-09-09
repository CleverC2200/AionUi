import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { classifyPrGates } = require('../../../scripts/classify-pr-gates');

describe('classifyPrGates', () => {
  it('keeps documentation-only changes on the lightweight path', () => {
    expect(classifyPrGates(['docs/guides/setup.md', 'README.md'])).toEqual({
      docs_only: true,
      cross_platform_tests: false,
      installer_smoke: false,
      release_scripts: false,
    });
  });

  it('runs the macOS baseline without cross-platform installers for renderer-only changes', () => {
    expect(classifyPrGates(['packages/desktop/src/renderer/pages/conversation/index.tsx'])).toEqual({
      docs_only: false,
      cross_platform_tests: false,
      installer_smoke: false,
      release_scripts: false,
    });
  });

  it('upgrades native process changes to the cross-platform unit matrix', () => {
    const result = classifyPrGates(['packages/desktop/src/process/services/database/index.ts']);

    expect(result.cross_platform_tests).toBe(true);
    expect(result.installer_smoke).toBe(false);
  });

  it('runs installer smoke tests for packaging inputs', () => {
    const result = classifyPrGates(['packages/shared-scripts/src/prepare-aioncore.js']);

    expect(result.cross_platform_tests).toBe(true);
    expect(result.installer_smoke).toBe(true);
  });

  it('runs release script checks only when their contract changes', () => {
    const result = classifyPrGates(['scripts/prepare-release-assets.sh']);

    expect(result.release_scripts).toBe(true);
  });

  it('fails open to the full gate when the changed-file list is unavailable', () => {
    expect(classifyPrGates([])).toEqual({
      docs_only: false,
      cross_platform_tests: true,
      installer_smoke: true,
      release_scripts: true,
    });
  });

  it('fails open to the full gate when a changed path is not classified', () => {
    expect(classifyPrGates(['unknown/new-build-input.cfg'])).toEqual({
      docs_only: false,
      cross_platform_tests: true,
      installer_smoke: true,
      release_scripts: true,
    });
  });
});

describe('PR gate workflow', () => {
  const workflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8');

  it('keeps required check names while routing low-risk changes to lightweight jobs', () => {
    expect(workflow).toContain('name: Unit Tests (${{ matrix.os }})');
    expect(workflow).toContain('name: Build Test (${{ matrix.platform }})');
    expect(workflow).toContain('Fast client build (macOS)');
    expect(workflow).toContain('Record lightweight platform pass');
    expect(workflow).toContain('Record lightweight build pass');
  });

  it('does not leak build-matrix expressions into the standalone i18n job', () => {
    const i18nSection = workflow.split('\n  i18n-check:')[1].split('\n  # Job 4:')[0];

    expect(i18nSection).not.toContain('matrix.platform');
  });
});

describe('desktop PR optimization safeguards', () => {
  const workflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8');
  it('keeps real baseline tests when Windows-specific coverage is not needed', () => {
    const unit = workflow.split('\n  unit-tests:')[1].split('\n  # Job 3:')[0];
    expect(unit).toContain('os: [macos-14, windows-2022]');
    expect(unit).toContain("matrix.os == 'macos-14' || needs.classify-changes.outputs.cross_platform_tests == 'true'");
    expect(unit).not.toContain('unit-evidence-ubuntu');
  });
  it('preserves base-change validation without cancelling checks on text edits', () => {
    expect(workflow).toContain("github.event.action != 'edited' || github.event.changes.base");
    expect(workflow).toContain("github.event.action == 'edited' && !github.event.changes.base && github.run_id");
    expect(workflow).toContain('reopened');
  });
  it('keeps a client compile when installers are not applicable', () => {
    expect(workflow).toContain(
      "needs.classify-changes.outputs.installer_smoke != 'true' && matrix.platform == 'macos-arm64'"
    );
    expect(workflow).not.toContain("platform: 'linux-x64'");
  });
});
